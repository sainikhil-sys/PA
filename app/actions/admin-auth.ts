"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { endCurrentAdminSession, getAdminSession } from "@/lib/admin/admin-session";
import { writeAudit } from "@/lib/admin/audit";
import { emailHash, ipPrefix } from "@/lib/admin/core";
import { beginEnrolment, confirmEnrolment, requestEnrolmentCode, stepUp } from "@/lib/admin/mfa";
import { getAdminRole } from "@/lib/admin/roles";
import { getSession } from "@/lib/auth/session";
import { errMessage, log } from "@/lib/log";

/** Unlocking the console: email-confirmed authenticator setup, then a code for each admin session. */

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const NOT_FOUND = { ok: false as const, error: "Not found" };
const codeInput = z.object({ code: z.string().trim().min(6).max(20) });

async function context() {
  const session = await getSession();
  if (!session) return null;
  const role = await getAdminRole(session.user);
  if (!role) return null;
  const h = await headers();
  return { session, role, ip: ipPrefix(h.get("x-forwarded-for")?.split(",")[0]?.trim()), ua: h.get("user-agent")?.slice(0, 300) ?? null };
}

async function guarded<T>(fn: () => Promise<Res<T>>): Promise<Res<T>> {
  try {
    return await fn();
  } catch (err) {
    log.error("admin.auth_failed", { error: errMessage(err) });
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

export async function requestAdminSetupCode(): Promise<Res> {
  return guarded(async () => {
    const c = await context();
    if (!c) return NOT_FOUND;
    return requestEnrolmentCode(c.session.user);
  });
}

export async function startAdminSetup(input: { code: string }): Promise<Res<{ secret: string; qr: string; recoveryCodes: string[] }>> {
  return guarded(async () => {
    const c = await context();
    if (!c) return NOT_FOUND;
    const p = codeInput.safeParse(input);
    if (!p.success) return { ok: false, error: "Enter the 6-digit code from the email." };
    const r = await beginEnrolment(c.session.user, p.data.code);
    if (!r.ok) return r;
    return { ok: true, secret: r.secret, qr: r.qr, recoveryCodes: r.recoveryCodes };
  });
}

export async function confirmAdminSetup(input: { code: string }): Promise<Res> {
  return guarded(async () => {
    const c = await context();
    if (!c) return NOT_FOUND;
    const p = codeInput.safeParse(input);
    if (!p.success) return { ok: false, error: "Enter the 6-digit code from your authenticator app." };
    const r = await confirmEnrolment({ user: c.session.user, role: c.role, userSessionId: c.session.sessionId, platform: "web", cookie: true, ipPrefix: c.ip, userAgent: c.ua, code: p.data.code });
    return r.ok ? { ok: true } : r;
  });
}

export async function unlockConsole(input: { code: string }): Promise<Res> {
  return guarded(async () => {
    const c = await context();
    if (!c) return NOT_FOUND;
    const p = codeInput.safeParse(input);
    if (!p.success) return { ok: false, error: "Enter the 6-digit code, or a recovery code." };
    const r = await stepUp({ user: c.session.user, role: c.role, userSessionId: c.session.sessionId, platform: "web", cookie: true, ipPrefix: c.ip, userAgent: c.ua, code: p.data.code });
    return r.ok ? { ok: true } : r;
  });
}

export async function lockConsole(): Promise<Res> {
  return guarded(async () => {
    const c = await context();
    if (!c) return NOT_FOUND;
    const s = await getAdminSession();
    await endCurrentAdminSession();
    if (s) {
      await writeAudit({ actorUserId: c.session.user.id, actorEmailHash: emailHash(c.session.user.email), actorRole: c.role, adminSessionId: s.id, action: "admin_session.end", resourceType: "admin_session", resourceId: s.id, outcome: "success", ipPrefix: c.ip, userAgent: c.ua });
    }
    return { ok: true };
  });
}
