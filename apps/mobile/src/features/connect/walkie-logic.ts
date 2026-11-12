import { parseAudioKey } from "./audio-keys";
import { toHex } from "./bytes";

/**
 * Walkie channels: pure rules and message parsing (no React Native, unit tested).
 *
 * A channel is software, not a radio frequency. The person who creates it (the host) keeps the
 * member list and sends it to everyone connected (walkie.channel). Joining asks the host
 * (walkie.join, with the code for a private channel). Members then give each other their audio send
 * keys (walkie.key) inside the encrypted session. A member hears only the members their phone is
 * directly connected to.
 */
export const MAX_MEMBERS = 6;
export const MAX_NAME = 32;
export const CODE_LENGTH = 6;
/** Wrong codes allowed per person per channel before the host stops answering them. */
export const MAX_CODE_ATTEMPTS = 5;
export const PING_EVERY_MS = 3_000;
/** No answer to pings for this long means the connection is lost. */
export const PING_LOST_MS = 10_000;
export const JOIN_TIMEOUT_MS = 10_000;

export type Member = { key: string; name: string };
/**
 * `members` is the full list for people in the channel. People outside it only get the host and
 * `count`, so who is in a channel is shared only with its members.
 */
export type Channel = { id: string; name: string; open: boolean; host: string; members: Member[]; count: number };
export type JoinRefusal = "code" | "full" | "closed" | "locked";

const ID_RE = /^[0-9a-f]{16}$/;
const PEER_RE = /^[0-9a-f]{64}$/;

export function newChannelId(randomBytes: (n: number) => Uint8Array): string {
  return toHex(randomBytes(8));
}

/** Six digits, uniformly random (rejection sampling avoids modulo bias). */
export function newJoinCode(randomBytes: (n: number) => Uint8Array): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  for (let i = 0; i < 64; i++) {
    const b = randomBytes(4);
    const n = ((b[0]! << 24) >>> 0) + (b[1]! << 16) + (b[2]! << 8) + b[3]!;
    if (n < limit) return String(n % 1_000_000).padStart(CODE_LENGTH, "0");
  }
  throw new Error("Random source is not random");
}

/** Digits only, as typed (spaces and dashes removed). Null unless exactly six digits. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Compares codes without stopping at the first difference. */
export function codesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** "123 456", easier to read aloud. */
export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function cleanChannelName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  // Control characters and line breaks never belong in a name shown to others.
  const name = input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return name || null;
}

function cleanMember(v: unknown): Member | null {
  if (!v || typeof v !== "object") return null;
  const m = v as { key?: unknown; name?: unknown };
  if (typeof m.key !== "string" || !PEER_RE.test(m.key)) return null;
  return { key: m.key, name: cleanChannelName(m.name)?.slice(0, 40) ?? "Cowork user" };
}

export type ChannelMessage = { kind: "announce"; channel: Channel } | { kind: "closed"; id: string };

/**
 * walkie.channel from `from`. Only a channel's host speaks for it, so the host field must be the
 * sender: nobody can announce or rewrite someone else's channel.
 */
export function parseChannelMessage(from: string, m: Record<string, unknown>): ChannelMessage | null {
  if (typeof m.id !== "string" || !ID_RE.test(m.id)) return null;
  if (m.closed === true) return { kind: "closed", id: m.id };
  const name = cleanChannelName(m.name);
  if (!name || typeof m.open !== "boolean" || !Array.isArray(m.members) || m.members.length > MAX_MEMBERS) return null;
  const members: Member[] = [];
  for (const raw of m.members) {
    const member = cleanMember(raw);
    if (!member) return null;
    if (!members.some((x) => x.key === member.key)) members.push(member);
  }
  if (!members.some((x) => x.key === from)) return null;
  const count = typeof m.count === "number" && Number.isInteger(m.count) ? Math.min(MAX_MEMBERS, Math.max(members.length, m.count)) : members.length;
  return { kind: "announce", channel: { id: m.id, name, open: m.open, host: from, members, count } };
}

/** The announcement for one recipient: the full member list only for members. */
export function channelMessage(c: Channel, forMember: boolean) {
  const members = forMember ? c.members : c.members.filter((m) => m.key === c.host);
  return { t: "walkie.channel", id: c.id, name: c.name, open: c.open, members, count: c.members.length };
}

export type JoinMessage = { kind: "request"; id: string; code: string | null } | { kind: "refused"; id: string; reason: JoinRefusal };

export function parseJoinMessage(m: Record<string, unknown>): JoinMessage | null {
  if (typeof m.id !== "string" || !ID_RE.test(m.id)) return null;
  if (m.ok === false) {
    const reason = m.reason === "code" || m.reason === "full" || m.reason === "closed" || m.reason === "locked" ? m.reason : "closed";
    return { kind: "refused", id: m.id, reason };
  }
  if (m.ok !== undefined) return null;
  return { kind: "request", id: m.id, code: m.code === undefined ? null : normalizeCode(m.code) };
}

export function parseChannelId(m: Record<string, unknown>): string | null {
  return typeof m.id === "string" && ID_RE.test(m.id) ? m.id : null;
}

export function parseKeyMessage(m: Record<string, unknown>): { id: string; key: string } | null {
  const id = parseChannelId(m);
  const key = parseAudioKey(m.key);
  return id && key ? { id, key } : null;
}

export function parsePing(m: Record<string, unknown>): { id: string; n: number } | null {
  const id = parseChannelId(m);
  if (!id || typeof m.n !== "number" || !Number.isInteger(m.n) || m.n < 0 || m.n > Number.MAX_SAFE_INTEGER) return null;
  return { id, n: m.n };
}

/** What the host's private state for its channel holds besides the channel itself. */
export type HostState = { channel: Channel; code: string | null; attempts: Map<string, number> };

export type JoinDecision = { ok: true; channel: Channel } | { ok: false; reason: JoinRefusal };

/** The host's answer to a join request. Mutates `attempts` only (wrong codes). */
export function decideJoin(host: HostState, from: Member, code: string | null): JoinDecision {
  const c = host.channel;
  if (c.members.some((m) => m.key === from.key)) return { ok: true, channel: c };
  if ((host.attempts.get(from.key) ?? 0) >= MAX_CODE_ATTEMPTS) return { ok: false, reason: "locked" };
  if (!c.open) {
    if (!host.code || !code || !codesMatch(code, host.code)) {
      host.attempts.set(from.key, (host.attempts.get(from.key) ?? 0) + 1);
      return { ok: false, reason: (host.attempts.get(from.key) ?? 0) >= MAX_CODE_ATTEMPTS ? "locked" : "code" };
    }
  }
  if (c.members.length >= MAX_MEMBERS) return { ok: false, reason: "full" };
  host.attempts.delete(from.key);
  const members = [...c.members, from];
  return { ok: true, channel: { ...c, members, count: members.length } };
}

export function removeMember(c: Channel, key: string): Channel {
  const members = c.members.filter((m) => m.key !== key);
  return { ...c, members, count: members.length };
}

/** Members added and removed between two versions of the member list (excluding me). */
export function rosterDiff(before: Member[], after: Member[], me: string): { added: Member[]; removed: Member[] } {
  const was = new Set(before.map((m) => m.key));
  const now = new Set(after.map((m) => m.key));
  return {
    added: after.filter((m) => m.key !== me && !was.has(m.key)),
    removed: before.filter((m) => m.key !== me && !now.has(m.key)),
  };
}

export function refusalText(reason: JoinRefusal): string {
  switch (reason) {
    case "code":
      return "That code is not right. Check it with the person who made the channel.";
    case "full":
      return `This channel is full. A channel holds up to ${MAX_MEMBERS} people.`;
    case "locked":
      return "Too many wrong codes. Ask the person who made the channel to make a new one.";
    case "closed":
      return "This channel has ended.";
  }
}

// ---------- Connection quality from ping round trips ----------

export type Quality = "good" | "fair" | "poor" | "lost" | "unknown";

export function qualityFor(rttMs: number | null, sinceLastPongMs: number | null): Quality {
  if (sinceLastPongMs !== null && sinceLastPongMs > PING_LOST_MS) return "lost";
  if (rttMs === null) return sinceLastPongMs === null ? "unknown" : "lost";
  if (rttMs < 150) return "good";
  if (rttMs < 400) return "fair";
  return "poor";
}

export const QUALITY_TEXT: Record<Quality, string> = { good: "Good connection", fair: "Fair connection", poor: "Weak connection", lost: "Connection lost", unknown: "Checking connection" };

/**
 * Tracks pings per person. The round trip is measured against this phone's own send time for that
 * ping number, so a peer cannot fake a better connection by echoing a different time.
 */
export class PingTracker {
  private next = 1;
  private outstanding = new Map<string, Map<number, number>>();
  private rtt = new Map<string, number>();
  private lastPong = new Map<string, number>();
  private firstPing = new Map<string, number>();

  ping(peer: string, now: number): number {
    const n = this.next++;
    const out = this.outstanding.get(peer) ?? new Map<number, number>();
    out.set(n, now);
    // Keep only recent pings.
    for (const k of out.keys()) if (k < n - 8) out.delete(k);
    this.outstanding.set(peer, out);
    if (!this.firstPing.has(peer)) this.firstPing.set(peer, now);
    return n;
  }

  pong(peer: string, n: number, now: number): number | null {
    const sent = this.outstanding.get(peer)?.get(n);
    if (sent === undefined) return null;
    this.outstanding.get(peer)!.delete(n);
    const rtt = Math.max(0, now - sent);
    const prev = this.rtt.get(peer);
    // Smoothed, so one slow packet does not flip the label.
    this.rtt.set(peer, prev === undefined ? rtt : Math.round(prev * 0.7 + rtt * 0.3));
    this.lastPong.set(peer, now);
    return rtt;
  }

  quality(peer: string, now: number): Quality {
    const last = this.lastPong.get(peer);
    const first = this.firstPing.get(peer);
    if (last === undefined) return first !== undefined && now - first > PING_LOST_MS ? "lost" : "unknown";
    return qualityFor(this.rtt.get(peer) ?? null, now - last);
  }

  forget(peer: string) {
    this.outstanding.delete(peer);
    this.rtt.delete(peer);
    this.lastPong.delete(peer);
    this.firstPing.delete(peer);
  }

  clear() {
    this.outstanding.clear();
    this.rtt.clear();
    this.lastPong.clear();
    this.firstPing.clear();
  }
}
