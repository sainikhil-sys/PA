import { createHmac, randomInt } from "node:crypto";
import { safeEqual } from "@/lib/security/crypto";

/** Pure OTP helpers (no I/O) so they can be unit tested. */

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 30;
export const TEST_OTP_CODE = "424242";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 6 digits from a CSPRNG (crypto.randomInt is uniform, no modulo bias). */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashEmail(email: string, secret: string): string {
  return createHmac("sha256", secret).update(`email:${normalizeEmail(email)}`).digest("hex");
}

/** Binds the code to the email so a code for one address never works for another. */
export function hashOtp(email: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`otp:${normalizeEmail(email)}:${code}`).digest("hex");
}

export function verifyOtpHash(email: string, code: string, storedHash: string, secret: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return safeEqual(hashOtp(email, code, secret), storedHash);
}

export function isEmailAllowed(email: string, allowed: string[]): boolean {
  const e = normalizeEmail(email);
  return allowed.some((a) => safeEqual(a, e));
}

/** Sign-in policy: open sign-up admits any well-formed address; otherwise the allowlist decides. */
export function canSignIn(email: string, policy: { open: boolean; allowed: string[] }): boolean {
  if (policy.open) return /^[^s@]+@[^s@]+.[^s@]+$/.test(normalizeEmail(email));
  return isEmailAllowed(email, policy.allowed);
}
