import { parseAudioKey } from "./audio-keys";
import { toHex } from "./bytes";

/**
 * Offline calls: the call state machine and message parsing. Pure (no React Native), unit tested.
 *
 * The caller sends call.invite (call id, its audio key, everyone invited) to each person. Each person
 * who answers sends call.accept and call.key to everyone in the call; people already in the call
 * answer a key with their own. Audio goes only between phones that are directly connected.
 */
export const MAX_CALL_PEOPLE = 4;
export const RING_TIMEOUT_MS = 45_000;
/** How long an ended call stays on screen before the screen closes itself. */
export const ENDED_LINGER_MS = 2_500;

export type Person = { key: string; name: string };
export type ParticipantState = "invited" | "joined" | "declined" | "left" | "lost" | "no_answer";
export type Participant = Person & { state: ParticipantState; hasKey: boolean };
export type CallPhase = "incoming" | "ringing" | "connecting" | "active" | "ended";
export type EndReason = "hangup" | "remote_ended" | "declined" | "busy" | "no_answer" | "missed" | "lost" | "failed" | "declined_by_me";

export type Call = {
  id: string;
  direction: "outgoing" | "incoming";
  /** The caller's public key. */
  host: string;
  /** Everyone except me. */
  participants: Participant[];
  /** False only for an incoming call I have not answered. */
  answered: boolean;
  phase: CallPhase;
  startedAt: number;
  connectedAt: number | null;
  endedAt: number | null;
  endReason: EndReason | null;
};

const CALL_ID_RE = /^[0-9a-f]{32}$/;
const PEER_RE = /^[0-9a-f]{64}$/;

export function newCallId(randomBytes: (n: number) => Uint8Array): string {
  return toHex(randomBytes(16));
}

function cleanName(v: unknown): string {
  if (typeof v !== "string") return "Cowork user";
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return s || "Cowork user";
}

export function parseCallId(m: Record<string, unknown>): string | null {
  return typeof m.callId === "string" && CALL_ID_RE.test(m.callId) ? m.callId : null;
}

export type Invite = { callId: string; key: string; members: Person[] };

/** call.invite from `from`. The caller must be in the member list, and so must I. */
export function parseInvite(from: string, me: string, m: Record<string, unknown>): Invite | null {
  const callId = parseCallId(m);
  const key = parseAudioKey(m.key);
  if (!callId || !key || !Array.isArray(m.members) || m.members.length < 2 || m.members.length > MAX_CALL_PEOPLE) return null;
  const members: Person[] = [];
  for (const raw of m.members) {
    if (!raw || typeof raw !== "object") return null;
    const p = raw as { key?: unknown; name?: unknown };
    if (typeof p.key !== "string" || !PEER_RE.test(p.key)) return null;
    if (!members.some((x) => x.key === p.key)) members.push({ key: p.key, name: cleanName(p.name) });
  }
  if (!members.some((x) => x.key === from) || !members.some((x) => x.key === me)) return null;
  return { callId, key, members };
}

export function parseCallKey(m: Record<string, unknown>): { callId: string; key: string } | null {
  const callId = parseCallId(m);
  const key = parseAudioKey(m.key);
  return callId && key ? { callId, key } : null;
}

export function outgoingCall(id: string, me: string, invitees: Person[], now: number): Call {
  return derive({
    id,
    direction: "outgoing",
    host: me,
    participants: invitees.map((p) => ({ ...p, state: "invited", hasKey: false })),
    answered: true,
    phase: "ringing",
    startedAt: now,
    connectedAt: null,
    endedAt: null,
    endReason: null,
  }, now);
}

/** An incoming call from an invite. The caller is in the call already; the others are being invited. */
export function incomingCall(invite: Invite, from: string, me: string, now: number): Call {
  return {
    id: invite.callId,
    direction: "incoming",
    host: from,
    participants: invite.members.filter((p) => p.key !== me).map((p) => ({ ...p, state: p.key === from ? "joined" : "invited", hasKey: false })),
    answered: false,
    phase: "incoming",
    startedAt: now,
    connectedAt: null,
    endedAt: null,
    endReason: null,
  };
}

export type CallEvent =
  | { type: "answer" }
  | { type: "accepted"; peer: string }
  | { type: "key"; peer: string }
  | { type: "declined"; peer: string; busy?: boolean }
  | { type: "left"; peer: string }
  | { type: "lost"; peer: string }
  | { type: "ring_timeout" }
  | { type: "hangup" }
  | { type: "decline" }
  | { type: "failed" };

const LIVE: ParticipantState[] = ["invited", "joined"];

function setState(call: Call, peer: string, state: ParticipantState): Call {
  return { ...call, participants: call.participants.map((p) => (p.key === peer && LIVE.includes(p.state) ? { ...p, state } : p)) };
}

function end(call: Call, reason: EndReason, now: number): Call {
  if (call.phase === "ended") return call;
  return { ...call, phase: "ended", endReason: reason, endedAt: now };
}

/** Recomputes the phase after a change, and ends the call when nobody is left. */
function derive(call: Call, now: number): Call {
  if (call.phase === "ended") return call;
  const joined = call.participants.filter((p) => p.state === "joined");
  const invited = call.participants.filter((p) => p.state === "invited");
  if (!call.answered) {
    // Still ringing here: it ends if the caller gives up.
    const caller = call.participants.find((p) => p.key === call.host);
    if (!caller || caller.state !== "joined") return end(call, "missed", now);
    return { ...call, phase: "incoming" };
  }
  if (!joined.length && !invited.length) {
    const states = call.participants.map((p) => p.state);
    const reason: EndReason =
      call.connectedAt !== null
        ? states.includes("lost") && !states.includes("left")
          ? "lost"
          : "remote_ended"
        : states.every((s) => s === "declined")
          ? "declined"
          : states.includes("lost")
            ? "lost"
            : states.includes("no_answer")
              ? "no_answer"
              : "declined";
    return end(call, reason, now);
  }
  if (!joined.length) return { ...call, phase: "ringing" };
  const audible = joined.some((p) => p.hasKey);
  const connectedAt = call.connectedAt ?? (audible ? now : null);
  return { ...call, phase: audible ? "active" : "connecting", connectedAt };
}

export function reduceCall(call: Call, e: CallEvent, now: number): Call {
  if (call.phase === "ended") return call;
  switch (e.type) {
    case "answer":
      return derive({ ...call, answered: true }, now);
    case "accepted":
      return derive(setState(call, e.peer, "joined"), now);
    case "key":
      return derive({ ...call, participants: call.participants.map((p) => (p.key === e.peer ? { ...p, hasKey: true } : p)) }, now);
    case "declined": {
      const next = derive(setState(call, e.peer, "declined"), now);
      // A 1:1 call refused because the other phone is already in a call.
      return e.busy && next.phase === "ended" && next.connectedAt === null ? { ...next, endReason: "busy" } : next;
    }
    case "left":
      return derive(setState(call, e.peer, "left"), now);
    case "lost":
      return derive(setState(call, e.peer, "lost"), now);
    case "ring_timeout":
      if (!call.answered) return end(call, "missed", now);
      return derive({ ...call, participants: call.participants.map((p) => (p.state === "invited" ? { ...p, state: "no_answer" } : p)) }, now);
    case "hangup":
      return end(call, "hangup", now);
    case "decline":
      return end(call, "declined_by_me", now);
    case "failed":
      return end(call, "failed", now);
  }
}

/** People who should hear about my accept, key or end: everyone still in the call or ringing. */
export function liveParticipants(call: Call): Participant[] {
  return call.participants.filter((p) => LIVE.includes(p.state));
}

export function isLive(call: Call | null): call is Call {
  return call !== null && call.phase !== "ended";
}

/** "0:42", "12:05", "1:02:09". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function callTitle(people: Person[]): string {
  if (!people.length) return "Call";
  if (people.length === 1) return people[0]!.name;
  if (people.length === 2) return `${people[0]!.name} and ${people[1]!.name}`;
  return `${people[0]!.name} and ${people.length - 1} others`;
}

export function endText(reason: EndReason | null): string {
  switch (reason) {
    case "declined":
      return "Declined";
    case "busy":
      return "They are in another call";
    case "no_answer":
      return "No answer";
    case "missed":
      return "Missed call";
    case "lost":
      return "Call ended: the connection was lost";
    case "failed":
      return "Call ended: voice stopped working on this phone";
    case "declined_by_me":
      return "You declined";
    default:
      return "Call ended";
  }
}

export type HistoryStatus = "completed" | "missed" | "declined" | "no_answer" | "busy" | "canceled" | "failed";

/** How a finished call is filed in history. */
export function historyStatus(call: Call): HistoryStatus {
  if (call.connectedAt !== null) return "completed";
  if (call.endReason === "failed") return "failed";
  if (call.direction === "incoming") return call.endReason === "declined_by_me" ? "declined" : "missed";
  if (call.endReason === "busy") return "busy";
  if (call.endReason === "declined") return "declined";
  if (call.endReason === "no_answer") return "no_answer";
  return "canceled";
}

export const HISTORY_TEXT: Record<HistoryStatus, string> = {
  completed: "Call",
  missed: "Missed",
  declined: "Declined",
  no_answer: "No answer",
  busy: "Busy",
  canceled: "Canceled",
  failed: "Failed",
};
