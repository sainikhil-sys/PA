/**
 * Pure rules for Chats (person-to-person messaging). No database or framework imports, so the
 * server, the tests and the app can share them.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 24;
export const MESSAGE_MAX = 4000;
export const GROUP_TITLE_MAX = 60;
export const GROUP_MAX_MEMBERS = 64;
/** A typing mark older than this is stale. */
export const TYPING_TTL_MS = 6_000;
/** "Active now" while the app checked in within this window. */
export const ONLINE_TTL_MS = 2 * 60_000;

/** Fixed reaction set, drawn as icons in the app (no emoji). */
export const REACTIONS = ["like", "love", "laugh", "wow", "sad", "thanks"] as const;
export type ReactionKind = (typeof REACTIONS)[number];

export const REPORT_REASONS = ["spam", "harassment", "hate", "sexual", "violence", "self_harm", "impersonation", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const RESERVED = new Set(["admin", "administrator", "cowork", "support", "help", "moderator", "mod", "system", "official", "staff", "security", "root", "null", "undefined", "me", "you"]);

/** Lowercases and trims a typed handle (a leading @ is allowed and dropped). */
export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

/** Null when the handle is acceptable, otherwise a sentence saying what to change. */
export function handleProblem(handle: string): string | null {
  if (handle.length < HANDLE_MIN) return `Use at least ${HANDLE_MIN} characters.`;
  if (handle.length > HANDLE_MAX) return `Use at most ${HANDLE_MAX} characters.`;
  if (!/^[a-z0-9._]+$/.test(handle)) return "Use only letters, numbers, dots and underscores.";
  if (!/^[a-z0-9]/.test(handle) || /[._]$/.test(handle)) return "Start and end with a letter or number.";
  if (/[._]{2}/.test(handle)) return "Don't put two dots or underscores next to each other.";
  if (RESERVED.has(handle) || handle.startsWith("cowork")) return "That handle is reserved. Try another.";
  return null;
}

/** A starting suggestion from a name or email local part: "Asha Rao" gives "asha.rao". */
export function suggestHandle(source: string): string {
  const base = source
    .split("@")[0]!
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^[._]+|[._]+$/g, "")
    .replace(/[._]{2,}/g, ".")
    .slice(0, HANDLE_MAX);
  const trimmed = base.replace(/[._]+$/g, "");
  return trimmed.length >= HANDLE_MIN && !handleProblem(trimmed) ? trimmed : `${trimmed || "user"}${Math.floor(100 + Math.random() * 900)}`.slice(0, HANDLE_MAX);
}

/** The ordered pair used for the one friendship row per two people. */
export function pair(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

export function directKey(a: string, b: string): string {
  const p = pair(a, b);
  return `${p.low}:${p.high}`;
}

export function isFresh(at: Date | string | null | undefined, ttlMs: number, now = Date.now()): boolean {
  if (!at) return false;
  const t = typeof at === "string" ? Date.parse(at) : at.getTime();
  return Number.isFinite(t) && now - t < ttlMs && t - now < 60_000;
}

export type DeliveryState = "sent" | "delivered" | "read";

/**
 * What the sender sees on their own message. `others` are the other current members' marks.
 * Read needs every other member to have read it (and to share read receipts); delivered needs
 * every other member's app to have received it.
 */
export function deliveryState(seq: number, others: { deliveredSeq: number; readSeq: number; readReceipts: boolean }[], viewerSharesReceipts: boolean): DeliveryState {
  if (!others.length) return "sent";
  if (viewerSharesReceipts && others.every((o) => o.readReceipts && o.readSeq >= seq)) return "read";
  if (others.every((o) => o.deliveredSeq >= seq || o.readSeq >= seq)) return "delivered";
  return "sent";
}

/** A one-line preview for the chat list; deleted and system messages read as plain sentences. */
export function previewText(m: { body: string; kind: string; deletedAt: Date | string | null }, fromMe: boolean, senderName: string | null): string {
  if (m.deletedAt) return fromMe ? "You deleted a message" : "Message deleted";
  const body = m.body.replace(/\s+/g, " ").trim();
  if (m.kind === "system") return body;
  const short = body.length > 120 ? `${body.slice(0, 117)}...` : body;
  if (fromMe) return `You: ${short}`;
  return senderName ? `${senderName}: ${short}` : short;
}

/** Message text after trimming; null when there is nothing to send. */
export function cleanBody(input: string): string | null {
  // Strip control characters except newline and tab; collapse runs of blank lines.
  const s = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\n{4,}/g, "\n\n\n").trim();
  return s ? s : null;
}
