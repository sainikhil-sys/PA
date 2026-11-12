import "server-only";
import { createHmac } from "node:crypto";
import { env } from "@/lib/env";

/** How long a channel token lasts; the app asks for a new one before it runs out. */
export const REALTIME_TOKEN_TTL_S = 15 * 60;

/** Each person listens on exactly one private channel. The database policy only lets them join their own. */
export const userTopic = (userId: string) => `user:${userId}`;

export type RealtimeConfig = { url: string; anonKey: string; serviceKey: string; jwtSecret: string };

/** Null until all four Supabase values are set; callers then fall back to polling. */
export function realtimeConfig(): RealtimeConfig | null {
  const e = env();
  if (!e.SUPABASE_URL || !e.SUPABASE_ANON_KEY || !e.SUPABASE_SERVICE_ROLE_KEY || !e.SUPABASE_JWT_SECRET) return null;
  // A malformed value turns realtime off (polling continues) instead of failing every request.
  if (!/^https:\/\/[\w.-]+$/.test(e.SUPABASE_URL.replace(/\/$/, "")) || e.SUPABASE_JWT_SECRET.length < 32) return null;
  return { url: e.SUPABASE_URL.replace(/\/$/, ""), anonKey: e.SUPABASE_ANON_KEY, serviceKey: e.SUPABASE_SERVICE_ROLE_KEY, jwtSecret: e.SUPABASE_JWT_SECRET };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/**
 * A short-lived token for Supabase Realtime: `sub` is the Cowork user id and the role is
 * `authenticated`, which the `realtime.messages` policy (migration) checks against the topic.
 * It grants nothing else: Cowork never uses Supabase Auth or the Data API.
 */
export function mintRealtimeToken(userId: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  const exp = now + REALTIME_TOKEN_TTL_S;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated", iat: now, exp }));
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return { token: `${header}.${payload}.${sig}`, expiresAt: exp * 1000 };
}
