import "server-only";
import { cache } from "react";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { readClientHeaders, type ClientInfo } from "@/lib/config/version";
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
  const client = clientColumns(readClientHeaders(h), opts.cookie === false ? "bearer" : "cookie");
  await db()
    .insert(schema.sessions)
    .values({ userId, tokenHash: sha256(token), userAgent: h.get("user-agent")?.slice(0, 300) ?? null, ipPrefix: ipPrefix(ip), expiresAt, ...client });
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
  return (await currentCredential())?.token ?? null;
}

async function currentCredential(): Promise<{ token: string; via: "cookie" | "bearer" } | null> {
  const cookie = (await cookies()).get(sessionCookieName())?.value;
  if (cookie) return { token: cookie, via: "cookie" };
  const auth = (await headers()).get("authorization") ?? "";
  const bearer = /^Bearer ([A-Za-z0-9_-]{32,200})$/.exec(auth)?.[1];
  return bearer ? { token: bearer, via: "bearer" } : null;
}

type ClientColumns = { platform: string | null; appVersion: string | null; appBuild: number | null; runtimeVersion: string | null; updateId: string | null };

/**
 * The client details stored on the session (X-Cowork-* headers). Bearer tokens are only issued to the
 * Android app, so a Bearer request without the platform header is the app (builds before the headers).
 */
function clientColumns(c: ClientInfo, via: "cookie" | "bearer"): ClientColumns {
  return {
    platform: c.platform ?? (via === "bearer" ? "android" : "web"),
    appVersion: c.appVersion,
    appBuild: c.build,
    runtimeVersion: c.runtimeVersion,
    updateId: c.updateId,
  };
}

function sameClient(a: ClientColumns, b: ClientColumns): boolean {
  return a.platform === b.platform && a.appVersion === b.appVersion && a.appBuild === b.appBuild && a.runtimeVersion === b.runtimeVersion && a.updateId === b.updateId;
}

/** Validates the session cookie against the DB and re-checks the sign-in policy every time. */
async function loadSession(): Promise<{ user: User; sessionId: string } | null> {
  const cred = await currentCredential();
  const token = cred?.token;
  if (!cred || !token || token.length < 32) return null;
  const now = new Date();
  const [row] = await db()
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (!mayUseApp(row.user.email) || row.user.disabledAt) return null;
  const client = clientColumns(readClientHeaders(await headers()), cred.via);
  // The touch also records the latest client details (version adoption); a new app version is written at once.
  if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS || (cred.via === "bearer" && !sameClient(client, row.session))) {
    // Fire-and-forget: never make a page wait on a bookkeeping write.
    void db()
      .update(schema.sessions)
      .set({ lastSeenAt: now, ...client })
      .where(eq(schema.sessions.id, row.session.id))
      .catch(() => {});
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
