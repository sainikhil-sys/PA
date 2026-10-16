import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { allowedEmails, isProd } from "@/lib/env";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { isEmailAllowed } from "./otp-core";

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

export async function createSession(userId: string) {
  const token = randomToken(32);
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db()
    .insert(schema.sessions)
    .values({ userId, tokenHash: sha256(token), userAgent: h.get("user-agent")?.slice(0, 300) ?? null, ipPrefix: ipPrefix(ip), expiresAt });
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

async function currentToken(): Promise<string | null> {
  return (await cookies()).get(sessionCookieName())?.value ?? null;
}

/** Validates the session cookie against the DB and re-checks the allowlist every time. */
export async function getSession(): Promise<{ user: User; sessionId: string } | null> {
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
  if (!isEmailAllowed(row.user.email, allowedEmails())) return null;
  if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db().update(schema.sessions).set({ lastSeenAt: now }).where(eq(schema.sessions.id, row.session.id));
  }
  return { user: row.user, sessionId: row.session.id };
}

export async function getOwner(): Promise<User | null> {
  return (await getSession())?.user ?? null;
}

/** For server components & actions: redirect to /login unless the owner is signed in. */
export async function requireOwner(): Promise<User> {
  const user = await getOwner();
  if (!user) redirect("/login");
  return user;
}

/** The single owner account, for cron jobs and background work (no session). */
export async function getOwnerForSystem(): Promise<User | null> {
  const email = allowedEmails()[0];
  if (!email) return null;
  return (await db().query.users.findFirst({ where: eq(schema.users.email, email) })) ?? null;
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
