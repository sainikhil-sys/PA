"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requestOtp, verifyOtp } from "@/lib/auth/otp";
import { getOwner, revokeSession, signOutCurrent, signOutEverywhere } from "@/lib/auth/session";
import { logActivity } from "@/lib/db/queries/activity";

async function ip(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const codeSchema = z.string().regex(/^\d{6}$/);

export async function requestCodeAction(email: string): Promise<{ ok: boolean; message: string }> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, message: "Enter a valid email address." };
  return requestOtp(parsed.data, await ip());
}

export async function verifyCodeAction(email: string, code: string): Promise<{ ok: boolean; message: string; redirectTo?: string }> {
  const e = emailSchema.safeParse(email);
  const c = codeSchema.safeParse(code);
  if (!e.success || !c.success) return { ok: false, message: "Enter the 6-digit code from your email." };
  const res = await verifyOtp(e.data, c.data, await ip());
  if (!res.ok) return res;
  return { ok: true, message: res.message, redirectTo: res.isNew ? "/onboarding" : "/" };
}

export async function signOutAction() {
  const user = await getOwner();
  if (user) await logActivity({ userId: user.id, actor: "me", tool: "auth.sign_out", outcome: "success" });
  await signOutCurrent();
  redirect("/login");
}

export async function signOutEverywhereAction() {
  const user = await getOwner();
  if (!user) redirect("/login");
  await logActivity({ userId: user.id, actor: "me", tool: "auth.sign_out_everywhere", outcome: "success" });
  await signOutEverywhere(user.id);
  redirect("/login");
}

export async function revokeSessionAction(sessionId: string) {
  const user = await getOwner();
  if (!user) return { ok: false };
  if (!z.string().uuid().safeParse(sessionId).success) return { ok: false };
  await revokeSession(user.id, sessionId);
  await logActivity({ userId: user.id, actor: "me", tool: "auth.session_revoked", outcome: "success" });
  return { ok: true };
}
