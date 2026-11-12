import "server-only";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { generateOtpCode, hashEmail, hashOtp, OTP_MAX_ATTEMPTS, OTP_TTL_MS, TEST_OTP_CODE, verifyOtpHash } from "@/lib/auth/otp-core";
import { BRAND } from "@/lib/brand";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { isTestMode, requireEnv } from "@/lib/env";
import { decrypt, encrypt } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/ratelimit";
import { createAdminSession, revokeAdminSessions } from "./admin-session";
import { writeAudit } from "./audit";
import { emailHash, STEP_UP_LOCK_MS, STEP_UP_MAX_FAILURES } from "./core";
import { alertOwner, sendAdminCode } from "./emails";
import type { AdminRole } from "./permissions";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, matchRecoveryCode, otpauthUri, stepAt, verifyTotp } from "./totp";

export type MfaStatus = { enrolled: boolean; lockedUntil: Date | null };
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const RATE_LIMITED = "Too many attempts. Wait a few minutes and try again.";
const purposeEmail = (email: string) => `admin-enrol:${email.trim().toLowerCase()}`;

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  const [row] = await db().select({ enabledAt: schema.adminMfa.enabledAt, lockedUntil: schema.adminMfa.lockedUntil }).from(schema.adminMfa).where(eq(schema.adminMfa.userId, userId)).limit(1);
  const locked = row?.lockedUntil && row.lockedUntil.getTime() > Date.now() ? row.lockedUntil : null;
  return { enrolled: Boolean(row?.enabledAt), lockedUntil: locked };
}

/** Step 1 of setup: email a code to the account's own address (a fresh check on top of the session). */
export async function requestEnrolmentCode(user: User): Promise<Result> {
  if ((await getMfaStatus(user.id)).enrolled) return { ok: false, error: "Two-step verification is already set up for this account." };
  if (!(await rateLimit("adminEmailCode", user.id)).success) return { ok: false, error: RATE_LIMITED };
  const secret = requireEnv("AUTH_SECRET");
  const purpose = purposeEmail(user.email);
  const h = hashEmail(purpose, secret);
  // Test mode (never on Vercel production) uses the same fixed code as sign-in.
  const code = isTestMode() ? TEST_OTP_CODE : generateOtpCode();
  await db().update(schema.otpCodes).set({ consumedAt: new Date() }).where(and(eq(schema.otpCodes.emailHash, h), isNull(schema.otpCodes.consumedAt)));
  await db().insert(schema.otpCodes).values({ emailHash: h, codeHash: hashOtp(purpose, code, secret), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
  if (!(await sendAdminCode(user.email, code))) return { ok: false, error: "We couldn't send the email. Try again in a minute." };
  return { ok: true };
}

async function consumeEmailCode(user: User, code: string): Promise<boolean> {
  const secret = requireEnv("AUTH_SECRET");
  const purpose = purposeEmail(user.email);
  const h = hashEmail(purpose, secret);
  const [row] = await db()
    .select()
    .from(schema.otpCodes)
    .where(and(eq(schema.otpCodes.emailHash, h), isNull(schema.otpCodes.consumedAt), gt(schema.otpCodes.expiresAt, new Date())))
    .orderBy(desc(schema.otpCodes.createdAt))
    .limit(1);
  if (!row || row.attempts >= OTP_MAX_ATTEMPTS) return false;
  if (!/^\d{6}$/.test(code) || !verifyOtpHash(purpose, code, row.codeHash, secret)) {
    await db()
      .update(schema.otpCodes)
      .set({ attempts: sql`${schema.otpCodes.attempts} + 1`, ...(row.attempts + 1 >= OTP_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) })
      .where(eq(schema.otpCodes.id, row.id));
    return false;
  }
  const used = await db()
    .update(schema.otpCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(schema.otpCodes.id, row.id), isNull(schema.otpCodes.consumedAt)))
    .returning({ id: schema.otpCodes.id });
  return used.length === 1;
}

/**
 * Step 2 of setup: with the emailed code, create a new authenticator secret and recovery codes.
 * They are returned once and never again. The secret grants nothing until step 3 confirms it.
 */
export async function beginEnrolment(user: User, emailCode: string): Promise<Result<{ secret: string; uri: string; qr: string; recoveryCodes: string[] }>> {
  if ((await getMfaStatus(user.id)).enrolled) return { ok: false, error: "Two-step verification is already set up for this account." };
  if (!(await rateLimit("adminStepUp", `enrol:${user.id}`)).success) return { ok: false, error: RATE_LIMITED };
  if (!(await consumeEmailCode(user, emailCode.trim()))) return { ok: false, error: "That code didn't work. Check the email and try again, or ask for a new code." };
  const secret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const values = { totpSecretEnc: encrypt(secret), recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode), enabledAt: null, lastUsedStep: null, failedCount: 0, lockedUntil: null };
  // Never overwrite a confirmed setup.
  await db()
    .insert(schema.adminMfa)
    .values({ userId: user.id, ...values })
    .onConflictDoUpdate({ target: schema.adminMfa.userId, set: values, setWhere: isNull(schema.adminMfa.enabledAt) });
  const uri = otpauthUri(secret, user.email, `${BRAND.name} Admin`);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: "M" });
  return { ok: true, secret, uri, qr, recoveryCodes };
}

type StepUpOpts = { user: User; role: AdminRole; userSessionId: string; platform: "web" | "android"; cookie: boolean; ipPrefix: string | null; userAgent: string | null };

/** Step 3 of setup: the first code from the authenticator app turns it on and unlocks the console. */
export async function confirmEnrolment(o: StepUpOpts & { code: string }): Promise<Result<{ token: string; expiresAt: Date }>> {
  if (!(await rateLimit("adminStepUp", o.user.id)).success) return { ok: false, error: RATE_LIMITED };
  const [row] = await db().select().from(schema.adminMfa).where(eq(schema.adminMfa.userId, o.user.id)).limit(1);
  if (!row || row.enabledAt) return { ok: false, error: "Start setup again: there is no pending authenticator to confirm." };
  const step = verifyTotp(decrypt(row.totpSecretEnc), o.code.trim(), Date.now());
  if (step === null) return { ok: false, error: "That code didn't match. Check the time on your phone is set automatically, then try the newest code." };
  const done = await db()
    .update(schema.adminMfa)
    .set({ enabledAt: new Date(), lastUsedStep: step, failedCount: 0, lockedUntil: null })
    .where(and(eq(schema.adminMfa.userId, o.user.id), isNull(schema.adminMfa.enabledAt)))
    .returning({ userId: schema.adminMfa.userId });
  if (!done.length) return { ok: false, error: "Setup was already finished in another window. Use a code to unlock." };
  await writeAudit({ actorUserId: o.user.id, actorEmailHash: emailHash(o.user.email), actorRole: o.role, action: "mfa.enrol", resourceType: "admin_mfa", resourceId: o.user.id, outcome: "success", ipPrefix: o.ipPrefix, userAgent: o.userAgent });
  void alertOwner("Two-step verification set up", [`An account with the ${o.role} role finished setting up its authenticator app.`, `Platform: ${o.platform}.`]);
  return startSession(o, "totp");
}

async function startSession(o: StepUpOpts, method: "totp" | "recovery"): Promise<Result<{ token: string; expiresAt: Date }>> {
  const s = await createAdminSession({ userId: o.user.id, userSessionId: o.userSessionId, method, platform: o.platform, cookie: o.cookie });
  await writeAudit({ actorUserId: o.user.id, actorEmailHash: emailHash(o.user.email), actorRole: o.role, action: "admin_session.start", resourceType: "admin_session", after: { method, platform: o.platform }, outcome: "success", ipPrefix: o.ipPrefix, userAgent: o.userAgent });
  if (o.role !== "owner" || method === "recovery") {
    void alertOwner(method === "recovery" ? "Recovery code used" : "New admin session", [`An account with the ${o.role} role unlocked the console${method === "recovery" ? " with a recovery code" : ""}.`, `Platform: ${o.platform}.`]);
  }
  return { ok: true, ...s };
}

/**
 * Unlocks the console with a 6-digit authenticator code or a recovery code. Five wrong codes lock
 * admin access for 15 minutes, end the person's admin sessions and alert the owner.
 */
export async function stepUp(o: StepUpOpts & { code: string }): Promise<Result<{ token: string; expiresAt: Date }>> {
  const [byUser, byIp] = await Promise.all([rateLimit("adminStepUp", o.user.id), rateLimit("adminStepUp", `ip:${o.ipPrefix ?? "none"}`)]);
  if (!byUser.success || !byIp.success) return { ok: false, error: RATE_LIMITED };
  const [row] = await db().select().from(schema.adminMfa).where(eq(schema.adminMfa.userId, o.user.id)).limit(1);
  if (!row?.enabledAt) return { ok: false, error: "Set up two-step verification first." };
  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return { ok: false, error: `Admin access is locked after too many wrong codes. Try again after ${row.lockedUntil.toISOString().slice(11, 16)} UTC.` };
  }
  const code = o.code.trim();
  let method: "totp" | "recovery" | null = null;
  if (/^\d{6}$/.test(code)) {
    const step = verifyTotp(decrypt(row.totpSecretEnc), code, Date.now(), { lastUsedStep: row.lastUsedStep });
    if (step !== null) {
      // Conditional: two requests with the same code can't both win.
      const won = await db()
        .update(schema.adminMfa)
        .set({ lastUsedStep: step, failedCount: 0 })
        .where(and(eq(schema.adminMfa.userId, o.user.id), sql`(${schema.adminMfa.lastUsedStep} is null or ${schema.adminMfa.lastUsedStep} < ${step})`))
        .returning({ userId: schema.adminMfa.userId });
      if (won.length) method = "totp";
    }
  } else {
    const hash = matchRecoveryCode(code, row.recoveryCodeHashes);
    if (hash) {
      const won = await db()
        .update(schema.adminMfa)
        .set({ recoveryCodeHashes: sql`array_remove(${schema.adminMfa.recoveryCodeHashes}, ${hash})`, failedCount: 0 })
        .where(and(eq(schema.adminMfa.userId, o.user.id), sql`${hash} = any(${schema.adminMfa.recoveryCodeHashes})`))
        .returning({ userId: schema.adminMfa.userId });
      if (won.length) method = "recovery";
    }
  }
  if (method) return startSession(o, method);

  const failures = row.failedCount + 1;
  const lock = failures >= STEP_UP_MAX_FAILURES;
  await db()
    .update(schema.adminMfa)
    .set(lock ? { failedCount: 0, lockedUntil: new Date(Date.now() + STEP_UP_LOCK_MS) } : { failedCount: failures })
    .where(eq(schema.adminMfa.userId, o.user.id));
  await writeAudit({
    actorUserId: o.user.id,
    actorEmailHash: emailHash(o.user.email),
    actorRole: o.role,
    action: lock ? "admin.step_up_locked" : "admin.step_up_failed",
    resourceType: "admin_mfa",
    resourceId: o.user.id,
    after: { failures },
    outcome: "denied",
    ipPrefix: o.ipPrefix,
    userAgent: o.userAgent,
  });
  if (lock) {
    await revokeAdminSessions(o.user.id);
    void alertOwner("Admin access locked", [`An account with the ${o.role} role entered ${STEP_UP_MAX_FAILURES} wrong codes. Admin access for it is locked for 15 minutes.`, `Platform: ${o.platform}.`]);
    return { ok: false, error: "Too many wrong codes. Admin access is locked for 15 minutes, and the owner has been told." };
  }
  return { ok: false, error: `That code didn't work. ${STEP_UP_MAX_FAILURES - failures} ${STEP_UP_MAX_FAILURES - failures === 1 ? "try" : "tries"} left before admin access locks for 15 minutes.` };
}

/** Recovery codes left, for the Security page. */
export async function recoveryCodesLeft(userId: string): Promise<number> {
  const [row] = await db().select({ n: sql<number>`cardinality(${schema.adminMfa.recoveryCodeHashes})` }).from(schema.adminMfa).where(eq(schema.adminMfa.userId, userId)).limit(1);
  return Number(row?.n ?? 0);
}

export { stepAt };
