import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) for admin step-up, and single-use recovery codes. Pure: no database, no env.
 * 30-second steps, 6 digits, HMAC-SHA1 (what authenticator apps support), plus or minus one step.
 */
export const STEP_SECONDS = 30;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number, digits = 6, algorithm: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function stepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/**
 * The step a code matches (current step plus or minus `window`), or null. A step at or before
 * `lastUsedStep` never matches, so a code can't be replayed.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number, opts: { window?: number; lastUsedStep?: number | null } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const now = stepAt(nowMs);
  const window = opts.window ?? 1;
  let matched: number | null = null;
  // Check every candidate (no early exit) so timing doesn't reveal which step matched.
  for (let s = now - window; s <= now + window; s++) {
    const ok = timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(code));
    if (ok && (opts.lastUsedStep == null || s > opts.lastUsedStep) && matched === null) matched = s;
  }
  return matched;
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// ---------- Recovery codes ----------
export const RECOVERY_CODE_COUNT = 10;

/** Ten codes like "K7MQ2-XR4TD" (50 bits each). Shown once; only hashes are stored. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const s = base32Encode(randomBytes(7)).slice(0, 10);
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(`cowork-admin-recovery:${normalizeRecoveryCode(code)}`).digest("hex");
}

/** The stored hash this code matches, or null. Compares against every hash. */
export function matchRecoveryCode(code: string, hashes: readonly string[]): string | null {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== 10) return null;
  const h = Buffer.from(hashRecoveryCode(normalized));
  let found: string | null = null;
  for (const stored of hashes) {
    const b = Buffer.from(stored);
    if (b.length === h.length && timingSafeEqual(b, h) && found === null) found = stored;
  }
  return found;
}
