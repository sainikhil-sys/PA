/**
 * Pure rules for Space rooms (Connect): the shared focus timer and listen-together links. No database
 * or framework imports, so the server and the tests share them.
 */

/** A heartbeat every 20 seconds keeps someone present; after 45 seconds of silence they drop off. */
export const PRESENT_WINDOW_MS = 45_000;
export const HEARTBEAT_MS = 20_000;
/** Listen together starts this long after someone sets the link, so everyone can open it first. */
export const LISTEN_LEAD_MS = 10_000;
/** Presence rows nobody refreshed for this long are deleted. */
export const PRESENCE_TIDY_MS = 3_600_000;
export const TIMER_MAX_MINUTES = 180;

export type MediaKind = "youtube" | "spotify";
export type RoomKind = "focus" | "listen";
export type TimerStatus = "idle" | "running" | "paused";

/** The columns these rules read. */
export type RoomState = {
  kind: RoomKind;
  timerStatus: TimerStatus;
  durationSec: number;
  endsAt: Date | null;
  remainingSec: number | null;
  mediaUrl: string | null;
};

export type RoomAction =
  | { action: "start"; minutes: number }
  | { action: "pause" }
  | { action: "resume" }
  | { action: "reset" }
  | { action: "media"; url: string }
  | { action: "restart" }
  | { action: "clearMedia" };

export type RoomChange = {
  timerStatus?: TimerStatus;
  durationSec?: number;
  endsAt?: Date | null;
  remainingSec?: number | null;
  mediaUrl?: string | null;
  mediaKind?: MediaKind | null;
  mediaStartAt?: Date | null;
};

/**
 * Accepts only public YouTube and Spotify links and returns a clean canonical URL (no tracking
 * parameters). Cowork never fetches or streams the media: each person opens the link in their own app.
 */
export function parseMediaUrl(raw: string): { url: string; kind: MediaKind } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const yt = /^[A-Za-z0-9_-]{11}$/;
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0] ?? "";
    return yt.test(id) ? { url: `https://www.youtube.com/watch?v=${id}`, kind: "youtube" } : null;
  }
  if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const id = u.pathname === "/watch" ? (u.searchParams.get("v") ?? "") : (/^\/(shorts|live)\/([^/]+)/.exec(u.pathname)?.[2] ?? "");
    return yt.test(id) ? { url: `https://www.youtube.com/watch?v=${id}`, kind: "youtube" } : null;
  }
  if (host === "open.spotify.com") {
    const m = /^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]{22})\/?$/.exec(u.pathname);
    return m ? { url: `https://open.spotify.com/${m[1]}/${m[2]}`, kind: "spotify" } : null;
  }
  return null;
}

/** What the timer shows at `now`: a running timer past its end reads as done. */
export function timerView(room: RoomState, now: number) {
  const endsAt = room.endsAt?.getTime() ?? null;
  const done = room.timerStatus === "running" && endsAt !== null && endsAt <= now;
  return {
    status: (done ? "done" : room.timerStatus) as TimerStatus | "done",
    durationSec: room.durationSec,
    endsAt: room.endsAt ? room.endsAt.toISOString() : null,
    remainingSec: room.timerStatus === "paused" ? room.remainingSec : room.timerStatus === "running" && endsAt !== null ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null,
  };
}

export class RoomRuleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The change one action makes, at server time `now`. Clients show the countdown from `endsAt` and
 * the server time they were sent, so every phone agrees whatever its own clock says.
 */
export function applyRoomAction(room: RoomState, a: RoomAction, now: number): RoomChange {
  if (a.action === "start" || a.action === "pause" || a.action === "resume" || a.action === "reset") {
    if (room.kind !== "focus") throw new RoomRuleError(400, "This room doesn't have a timer.");
    switch (a.action) {
      case "start": {
        const minutes = Math.min(Math.max(Math.trunc(a.minutes), 1), TIMER_MAX_MINUTES);
        return { timerStatus: "running", durationSec: minutes * 60, endsAt: new Date(now + minutes * 60_000), remainingSec: null };
      }
      case "pause":
        if (room.timerStatus !== "running" || !room.endsAt || room.endsAt.getTime() <= now) throw new RoomRuleError(409, "The timer isn't running.");
        return { timerStatus: "paused", remainingSec: Math.ceil((room.endsAt.getTime() - now) / 1000), endsAt: null };
      case "resume":
        if (room.timerStatus !== "paused" || !room.remainingSec) throw new RoomRuleError(409, "The timer isn't paused.");
        return { timerStatus: "running", endsAt: new Date(now + room.remainingSec * 1000), remainingSec: null };
      case "reset":
        return { timerStatus: "idle", endsAt: null, remainingSec: null };
    }
  }
  if (room.kind !== "listen") throw new RoomRuleError(400, "This room doesn't share music.");
  switch (a.action) {
    case "media": {
      const media = parseMediaUrl(a.url);
      if (!media) throw new RoomRuleError(400, "Paste a link to a YouTube video, or a Spotify track, album, playlist or episode.");
      return { mediaUrl: media.url, mediaKind: media.kind, mediaStartAt: new Date(now + LISTEN_LEAD_MS) };
    }
    case "restart":
      if (!room.mediaUrl) throw new RoomRuleError(409, "Add a link first.");
      return { mediaStartAt: new Date(now + LISTEN_LEAD_MS) };
    case "clearMedia":
      return { mediaUrl: null, mediaKind: null, mediaStartAt: null };
  }
}

/** True when a heartbeat at `lastSeenAt` still counts as present at `now`. */
export function isPresent(lastSeenAt: Date, now: number): boolean {
  return now - lastSeenAt.getTime() < PRESENT_WINDOW_MS;
}
