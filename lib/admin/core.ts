import { createHash } from "node:crypto";

/** Pure rules for admin sessions, confirmations and audit records. Unit tested. */

export const ADMIN_IDLE_MS = 15 * 60_000;
export const ADMIN_MAX_MS = 2 * 60 * 60_000;
/** Owner-only sensitive operations need a step-up newer than this. */
export const OWNER_FRESH_MS = 10 * 60_000;
export const CONFIRM_TTL_MS = 2 * 60_000;
export const STEP_UP_MAX_FAILURES = 5;
export const STEP_UP_LOCK_MS = 15 * 60_000;
/** lastSeenAt is written at most this often. */
export const ADMIN_TOUCH_MS = 30_000;

export type AdminSessionRow = { userId: string; userSessionId: string; createdAt: Date; lastSeenAt: Date; expiresAt: Date; revokedAt: Date | null };
export type AdminSessionCheck = "ok" | "revoked" | "expired" | "idle" | "other_session";

/** Whether an admin session may be used by this user session at this moment. */
export function checkAdminSession(row: AdminSessionRow, current: { userId: string; userSessionId: string }, now: number): AdminSessionCheck {
  if (row.revokedAt) return "revoked";
  if (row.userId !== current.userId || row.userSessionId !== current.userSessionId) return "other_session";
  if (row.expiresAt.getTime() <= now || now - row.createdAt.getTime() >= ADMIN_MAX_MS) return "expired";
  if (now - row.lastSeenAt.getTime() >= ADMIN_IDLE_MS) return "idle";
  return "ok";
}

/** JSON with object keys sorted, so the same input always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** Binds a confirmation token to one action and its exact input. */
export function inputHash(action: string, input: unknown): string {
  return createHash("sha256").update(`${action}\n${canonicalJson(input)}`).digest("hex");
}

/** Field names never stored in audit before/after values, at any depth. */
const SECRET_KEY = /(secret|token|password|passphrase|apikey|api_key|key_enc|private|credential|code_hash|recovery)/i;
const PERSONAL_KEY = /^(email|phone|address|name|ip|ipAddress|userAgent)$/i;

/** Copies a value for the audit log with secret and personal fields replaced by "[redacted]". */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redactForAudit(v, depth + 1));
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) || PERSONAL_KEY.test(k) ? "[redacted]" : redactForAudit(v, depth + 1);
  }
  return out;
}

/** "203.0.113.0" / "2001:db8:1::" style prefix, never the full address. */
export function ipPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (ip.includes(".")) return ip.split(".").slice(0, 3).join(".") + ".0";
  return ip.split(":").slice(0, 3).join(":") + "::";
}

export function emailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
