import "server-only";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { allowedEmails, isTestMode, requireEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/security/ratelimit";
import { sendOtpEmail } from "./mail";
import {
  generateOtpCode,
  hashEmail,
  hashOtp,
  isEmailAllowed,
  normalizeEmail,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  TEST_OTP_CODE,
  verifyOtpHash,
} from "./otp-core";
import { createSession } from "./session";

/** Same message whether or not the email is allowed: never reveal the allowlist. */
export const GENERIC_SENT = "If that email can sign in, a code is on its way.";
export const GENERIC_INVALID = "That code didn't work. Check it and try again, or request a new one.";
export const RATE_LIMITED = "Too many attempts. Please wait a few minutes and try again.";

export async function requestOtp(rawEmail: string, ip: string): Promise<{ ok: boolean; message: string }> {
  const email = normalizeEmail(rawEmail);
  const secret = requireEnv("AUTH_SECRET");
  const emailHash = hashEmail(email, secret);

  const [byEmail, byIp] = await Promise.all([rateLimit("otpEmail", emailHash), rateLimit("otpIp", ip)]);
  if (!byEmail.success || !byIp.success) return { ok: false, message: RATE_LIMITED };

  if (!isEmailAllowed(email, allowedEmails())) {
    // Do comparable work so timing doesn't reveal the allowlist.
    hashOtp(email, generateOtpCode(), secret);
    log.info("otp.requested", { allowed: false });
    return { ok: true, message: GENERIC_SENT };
  }

  const code = isTestMode() ? TEST_OTP_CODE : generateOtpCode();
  // Invalidate any earlier unused codes for this email (single active code).
  await db()
    .update(schema.otpCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(schema.otpCodes.emailHash, emailHash), isNull(schema.otpCodes.consumedAt)));
  await db()
    .insert(schema.otpCodes)
    .values({ emailHash, codeHash: hashOtp(email, code, secret), expiresAt: new Date(Date.now() + OTP_TTL_MS) });

  try {
    await sendOtpEmail(email, code);
  } catch {
    return { ok: false, message: "We couldn't send the email right now. Try again in a minute." };
  }
  log.info("otp.requested", { allowed: true });
  return { ok: true, message: GENERIC_SENT };
}

export async function verifyOtp(rawEmail: string, code: string, ip: string): Promise<{ ok: boolean; message: string; isNew?: boolean }> {
  const email = normalizeEmail(rawEmail);
  const secret = requireEnv("AUTH_SECRET");
  const emailHash = hashEmail(email, secret);

  const [byEmail, byIp] = await Promise.all([rateLimit("otpVerify", emailHash), rateLimit("otpVerify", `ip:${ip}`)]);
  if (!byEmail.success || !byIp.success) return { ok: false, message: RATE_LIMITED };

  const [row] = await db()
    .select()
    .from(schema.otpCodes)
    .where(and(eq(schema.otpCodes.emailHash, emailHash), isNull(schema.otpCodes.consumedAt), gt(schema.otpCodes.expiresAt, new Date())))
    .orderBy(desc(schema.otpCodes.createdAt))
    .limit(1);

  if (!row || row.attempts >= OTP_MAX_ATTEMPTS || !isEmailAllowed(email, allowedEmails())) {
    return { ok: false, message: GENERIC_INVALID };
  }

  if (!verifyOtpHash(email, code, row.codeHash, secret)) {
    const attempts = row.attempts + 1;
    await db()
      .update(schema.otpCodes)
      .set({ attempts: sql`${schema.otpCodes.attempts} + 1`, ...(attempts >= OTP_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) })
      .where(eq(schema.otpCodes.id, row.id));
    return { ok: false, message: GENERIC_INVALID };
  }

  // Single use: conditional update wins exactly once even under concurrent requests.
  const consumed = await db()
    .update(schema.otpCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(schema.otpCodes.id, row.id), isNull(schema.otpCodes.consumedAt)))
    .returning({ id: schema.otpCodes.id });
  if (!consumed.length) return { ok: false, message: GENERIC_INVALID };

  const [user] = await db()
    .insert(schema.users)
    .values({ email })
    .onConflictDoUpdate({ target: schema.users.email, set: { email } })
    .returning();
  await db().insert(schema.userSettings).values({ userId: user!.id }).onConflictDoNothing();
  await createSession(user!.id);
  await logActivity({ userId: user!.id, actor: "me", tool: "auth.sign_in", inputSummary: "email code", outcome: "success" });
  return { ok: true, message: "Signed in", isNew: !user!.onboardedAt };
}
