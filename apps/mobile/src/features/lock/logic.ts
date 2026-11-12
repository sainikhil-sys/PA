/**
 * App lock rules with no React Native imports, so they run under Vitest (tests/unit/app-lock.test.ts).
 *
 * PIN storage: PBKDF2-HMAC-SHA256 over the PIN with a random 16-byte salt, stored as
 * `pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>` in SecureStore (Android Keystore-backed).
 * A 4 or 6 digit PIN has a small key space, so the real protection is the Keystore and the attempt
 * limit below; the slow hash keeps a leaked record from being reversed instantly.
 */
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

export type PinLength = 4 | 6;
export const PIN_LENGTHS: readonly PinLength[] = [4, 6];

/** When the lock comes back after Cowork leaves the screen. A fresh launch always locks. */
export type LockPolicy = "immediate" | "30s" | "1m" | "5m" | "launch";

export const POLICIES: readonly { value: LockPolicy; label: string; detail: string }[] = [
  { value: "immediate", label: "Immediately", detail: "Locks as soon as you leave Cowork" },
  { value: "30s", label: "After 30 seconds", detail: "Locks when Cowork has been in the background for 30 seconds" },
  { value: "1m", label: "After 1 minute", detail: "Locks when Cowork has been in the background for 1 minute" },
  { value: "5m", label: "After 5 minutes", detail: "Locks when Cowork has been in the background for 5 minutes" },
  { value: "launch", label: "Only when Cowork starts", detail: "Locks when Cowork is opened fresh, for example after you close it from recent apps" },
];

/** Background time after which the lock returns; null means only a fresh launch locks. */
export const POLICY_MS: Record<LockPolicy, number | null> = {
  immediate: 0,
  "30s": 30_000,
  "1m": 60_000,
  "5m": 300_000,
  launch: null,
};

export function isPolicy(v: unknown): v is LockPolicy {
  return typeof v === "string" && v in POLICY_MS;
}

export function isPinLength(v: unknown): v is PinLength {
  return v === 4 || v === 6;
}

/**
 * Whether to lock when Cowork comes back to the foreground. `backgroundAt` is the earliest moment
 * Cowork was known to be leaving the screen; null means it never reached the background (for example
 * only the notification shade was pulled down), which never locks.
 */
export function shouldLockOnReturn(policy: LockPolicy, backgroundAt: number | null, now: number): boolean {
  if (backgroundAt === null) return false;
  const limit = POLICY_MS[policy];
  if (limit === null) return false;
  // A clock that moved backwards while away gives a negative gap: treat it as long enough to lock.
  const away = now - backgroundAt;
  return away < 0 || away >= limit;
}

/** Wrong PINs allowed before a wait starts. */
export const FREE_ATTEMPTS = 5;
/** Waits after the 5th, 6th, 7th... wrong PIN in a row; the last value repeats. */
export const LOCKOUT_STEPS_MS: readonly number[] = [30_000, 60_000, 300_000, 900_000, 1_800_000, 3_600_000];

/** The wait that follows the given count of wrong PINs in a row (0 while free attempts remain). */
export function lockoutDelayMs(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  const i = Math.min(failures - FREE_ATTEMPTS, LOCKOUT_STEPS_MS.length - 1);
  return LOCKOUT_STEPS_MS[i]!;
}

export type Attempts = { failures: number; lockedUntil: number };
export const NO_ATTEMPTS: Attempts = { failures: 0, lockedUntil: 0 };

/** Record one wrong PIN. */
export function registerFailure(a: Attempts, now: number): Attempts {
  const failures = a.failures + 1;
  const delay = lockoutDelayMs(failures);
  return { failures, lockedUntil: delay > 0 ? now + delay : 0 };
}

/**
 * Milliseconds left before another PIN may be tried. Capped at the wait for the current failure
 * count, so a clock set backwards cannot stretch the wait without end.
 */
export function remainingLockoutMs(a: Attempts, now: number): number {
  if (a.lockedUntil <= now) return 0;
  return Math.min(a.lockedUntil - now, lockoutDelayMs(a.failures));
}

/** Read stored attempts, falling back to none for anything malformed. */
export function parseAttempts(raw: string | null): Attempts {
  if (!raw) return NO_ATTEMPTS;
  try {
    const v = JSON.parse(raw) as Partial<Attempts>;
    const failures = Number.isInteger(v.failures) && (v.failures as number) >= 0 ? (v.failures as number) : 0;
    const lockedUntil = typeof v.lockedUntil === "number" && Number.isFinite(v.lockedUntil) ? v.lockedUntil : 0;
    return { failures, lockedUntil };
  } catch {
    return NO_ATTEMPTS;
  }
}

/** "30 seconds", "1 minute", "5 minutes", rounded up. */
export function waitText(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return s === 1 ? "1 second" : `${s} seconds`;
  const m = Math.ceil(s / 60);
  return m === 1 ? "1 minute" : `${m} minutes`;
}

export function isValidPin(pin: string, length: PinLength): boolean {
  return pin.length === length && /^[0-9]+$/.test(pin);
}

/** Equality that takes the same time wherever the first difference is. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * PBKDF2 rounds for new PINs. The hash runs in JavaScript on the phone, so this balances unlock time
 * against cost to an attacker; the count is stored with each record, so it can be raised later
 * without breaking PINs already set.
 */
export const PBKDF2_ITERATIONS = 60_000;
export const SALT_BYTES = 16;
const KEY_BYTES = 32;
const SCHEME = "pbkdf2-sha256";

export type PinRecord = { iterations: number; salt: Uint8Array; hash: Uint8Array };

export function encodeRecord(r: PinRecord): string {
  return [SCHEME, String(r.iterations), bytesToHex(r.salt), bytesToHex(r.hash)].join("$");
}

export function parseRecord(raw: string | null): PinRecord | null {
  if (!raw) return null;
  const parts = raw.split("$");
  if (parts.length !== 4 || parts[0] !== SCHEME) return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return null;
  try {
    const salt = hexToBytes(parts[2]!);
    const hash = hexToBytes(parts[3]!);
    if (salt.length < 8 || hash.length !== KEY_BYTES) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

/** Derive a PIN record. `salt` comes from a secure random source (expo-crypto on the phone). */
export async function hashPin(pin: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<PinRecord> {
  // asyncTick lets the JS thread draw a frame between chunks, so the spinner keeps moving.
  const hash = await pbkdf2Async(sha256, pin, salt, { c: iterations, dkLen: KEY_BYTES, asyncTick: 16 });
  return { iterations, salt, hash };
}

/** Check a PIN against a stored record, re-deriving with the record's own salt and rounds. */
export async function verifyPin(pin: string, record: PinRecord): Promise<boolean> {
  const { hash } = await hashPin(pin, record.salt, record.iterations);
  return constantTimeEqual(hash, record.hash);
}
