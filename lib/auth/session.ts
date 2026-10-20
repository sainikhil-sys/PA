import "server-only";
import { cache } from "react";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { isProd } from "@/lib/env";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { mayUseApp } from "./policy";

const SESSION_TTL_MS = 30 * 86_400_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

/** `__Host-` prefix: Secure, Path=/, no Domain. Only usable over HTTPS, so dev uses a plain name. */
export function sessionCookieName(): string {
  return isProd() ? "__Host-pa_session" : "pa_session";
}

function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  // Store a coarse prefix only (privacy): /24 for IPv4, /48 for IPv6.
  if (ip.includes(".")) return ip.split(".").slice(0, 3).join(".") + ".0";
  return ip.split(":").slice(0, 3).join(":") + "::";
}

/**
 * Starts a session. Browsers get it as an httpOnly cookie; the Android app (`cookie: false`)
 * gets the token back once and sends it as `Authorization: Bearer` (native HTTP has no cookie jar).
 */
export async function createSession(userId: string, opts: { cookie?: boolean } = {}): Promise<string> {
  const token = randomToken(32);
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db()
    .insert(schema.sessions)
    .values({ userId, tokenHash: sha256(token), userAgent: h.get("user-agent")?.slice(0, 300) ?? null, ipPrefix: ipPrefix(ip), expiresAt });
  if (opts.cookie !== false) {
    (await cookies()).set(sessionCookieName(), token, {
      httpOnly: true,
      secure: isProd(),
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  }
  return token;
}

/** The session cookie, or the Android app's bearer token. Browsers never attach bearer tokens on their own, so CSRF doesn't apply to them. */
async function currentToken(): Promise<string | null> {
  const cookie = (await cookies()).get(sessionCookieName())?.value;
  if (cookie) return cookie;
  const auth = (await headers()).get("authorization") ?? "";
  return /^Bearer ([A-Za-z0-9_-]{32,200})$/.exec(auth)?.[1] ?? null;
}

/** Validates the session cookie against the DB and re-checks the sign-in policy every time. */
async function loadSession(): Promise<{ user: User; sessionId: string } | null> {
  const token = await currentToken();
  if (!token || token.length < 32) return null;
  const now = new Date();
  const [row] = await db()
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (!mayUseApp(row.user.email) || row.user.disabledAt) return null;
  if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    // Fire-and-forget: never make a page wait on a bookkeeping write.
    void db().update(schema.sessions).set({ lastSeenAt: now }).where(eq(schema.sessions.id, row.session.id)).catch(() => {});
  }
  return { user: row.user, sessionId: row.session.id };
}

/** Memoized per request: layout + page + cards share ONE session lookup (each DB round trip costs ~300ms from India to Sydney). */
export const getSession = cache(loadSession);

export async function getOwner(): Promise<User | null> {
  return (await getSession())?.user ?? null;
}

/** For server components & actions: redirect to /login unless the owner is signed in. */
export async function requireOwner(): Promise<User> {
  const user = await getOwner();
  if (!user) redirect("/login");
  return user;
}

/** Every account that may still use the app, for cron jobs and background work (no session). */
export async function listUsersForSystem(limit = 1000): Promise<User[]> {
  const users = await db().select().from(schema.users).orderBy(schema.users.createdAt).limit(limit);
  return users.filter((u) => mayUseApp(u.email) && !u.disabledAt);
}

export async function signOutCurrent() {
  const token = await currentToken();
  if (token) await db().update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.tokenHash, sha256(token)));
  (await cookies()).delete(sessionCookieName());
}

export async function signOutEverywhere(userId: string) {
  await db()
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
  (await cookies()).delete(sessionCookieName());
}

export async function revokeSession(userId: string, sessionId: string) {
  await db()
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)));
}

export async function listSessions(userId: string) {
  return db()
    .select({
      id: schema.sessions.id,
      userAgent: schema.sessions.userAgent,
      ipPrefix: schema.sessions.ipPrefix,
      lastSeenAt: schema.sessions.lastSeenAt,
      createdAt: schema.sessions.createdAt,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())))
    .orderBy(desc(schema.sessions.lastSeenAt))
    .limit(20);
}
