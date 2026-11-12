import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getSession } from "@/lib/auth/session";
import { db, schema, type DB } from "@/lib/db";
import { isProd } from "@/lib/env";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { ADMIN_MAX_MS, ADMIN_TOUCH_MS, checkAdminSession, ipPrefix } from "./core";

/** The app sends its admin token in this header; it keeps the token in memory only. */
export const ADMIN_HEADER = "x-cowork-admin";

export function adminCookieName(): string {
  return isProd() ? "__Host-pa_admin" : "pa_admin";
}

export type AdminSession = { id: string; userId: string; method: "totp" | "recovery" | "passkey"; createdAt: Date; expiresAt: Date; lastSeenAt: Date };

async function currentAdminToken(): Promise<string | null> {
  const cookie = (await cookies()).get(adminCookieName())?.value;
  if (cookie) return cookie;
  const h = (await headers()).get(ADMIN_HEADER) ?? "";
  return /^[A-Za-z0-9_-]{32,200}$/.test(h) ? h : null;
}

/**
 * Starts an admin session after a successful step-up, bound to the current user session.
 * The web gets an httpOnly SameSite=Strict cookie; the app (`cookie: false`) gets the token once.
 */
export async function createAdminSession(o: { userId: string; userSessionId: string; method: AdminSession["method"]; platform: "web" | "android"; cookie: boolean }): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const h = await headers();
  const expiresAt = new Date(Date.now() + ADMIN_MAX_MS);
  await db()
    .insert(schema.adminSessions)
    .values({
      userId: o.userId,
      userSessionId: o.userSessionId,
      tokenHash: sha256(token),
      method: o.method,
      platform: o.platform,
      ipPrefix: ipPrefix(h.get("x-forwarded-for")?.split(",")[0]?.trim()),
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      expiresAt,
    });
  if (o.cookie) {
    (await cookies()).set(adminCookieName(), token, { httpOnly: true, secure: isProd(), sameSite: "strict", path: "/", expires: expiresAt });
  }
  return { token, expiresAt };
}

async function loadAdminSession(): Promise<AdminSession | null> {
  const token = await currentAdminToken();
  if (!token) return null;
  const session = await getSession();
  if (!session) return null;
  const [row] = await db().select().from(schema.adminSessions).where(eq(schema.adminSessions.tokenHash, sha256(token))).limit(1);
  if (!row) return null;
  const now = Date.now();
  if (checkAdminSession(row, { userId: session.user.id, userSessionId: session.sessionId }, now) !== "ok") return null;
  if (now - row.lastSeenAt.getTime() > ADMIN_TOUCH_MS) {
    // Awaited: the idle timer must move, or an active admin is locked out at 15 minutes.
    await db().update(schema.adminSessions).set({ lastSeenAt: new Date(now) }).where(eq(schema.adminSessions.id, row.id));
  }
  return { id: row.id, userId: row.userId, method: row.method, createdAt: row.createdAt, expiresAt: row.expiresAt, lastSeenAt: new Date(now) };
}

/** The valid admin session for this request, or null. Cached per request. */
export const getAdminSession = cache(loadAdminSession);

/** Ends this browser's or phone's admin session (the "Lock" button). */
export async function endCurrentAdminSession(): Promise<void> {
  const token = await currentAdminToken();
  if (token) await db().update(schema.adminSessions).set({ revokedAt: new Date() }).where(and(eq(schema.adminSessions.tokenHash, sha256(token)), isNull(schema.adminSessions.revokedAt)));
  (await cookies()).delete(adminCookieName());
}

/** Ends every admin session a person has (role change, suspension, lockout, sign-out everywhere). */
export async function revokeAdminSessions(userId: string, executor: Pick<DB, "update"> = db()): Promise<void> {
  await executor.update(schema.adminSessions).set({ revokedAt: new Date() }).where(and(eq(schema.adminSessions.userId, userId), isNull(schema.adminSessions.revokedAt)));
}
