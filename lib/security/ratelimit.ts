import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { sql } from "drizzle-orm";
import { log } from "@/lib/log";

export type LimitName = "mcp" | "api" | "social" | "auth" | "oauth" | "ai" | "otpEmail" | "otpIp" | "otpVerify" | "webhook" | "notifyEmail" | "phone" | "admin" | "adminStepUp" | "adminEmailCode";

/** Requests per window. Tuned for a single user plus Claude. */
const LIMITS: Record<LimitName, { tokens: number; window: `${number} s` | `${number} m` }> = {
  mcp: { tokens: 120, window: "1 m" },
  api: { tokens: 300, window: "1 m" },
  // Chats: sends, edits, reactions, friend requests and reports per person.
  social: { tokens: 90, window: "1 m" },
  auth: { tokens: 20, window: "1 m" },
  oauth: { tokens: 30, window: "1 m" },
  ai: { tokens: 30, window: "1 m" },
  otpEmail: { tokens: 5, window: "15 m" },
  // Offices and campuses share one IP: allow many people per network, still capped per address.
  otpIp: { tokens: 80, window: "15 m" },
  otpVerify: { tokens: 10, window: "15 m" },
  webhook: { tokens: 60, window: "1 m" },
  // Update emails per user per day: a runaway automation can never flood an inbox.
  notifyEmail: { tokens: 30, window: "1440 m" },
  // Linked phones post in small batches; generous but bounded.
  phone: { tokens: 120, window: "1 m" },
  // Admin console operations per person.
  admin: { tokens: 120, window: "1 m" },
  // Step-up code attempts per person and per IP (lockout after 5 wrong codes is separate).
  adminStepUp: { tokens: 10, window: "15 m" },
  // Enrolment email codes per person.
  adminEmailCode: { tokens: 5, window: "60 m" },
};

export type LimitResult = { success: boolean; limit: number; remaining: number; reset: number };

let limiters: Map<LimitName, Ratelimit> | null | undefined;

function upstash(): Map<LimitName, Ratelimit> | null {
  if (limiters !== undefined) return limiters;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      log.warn("ratelimit.fallback", { reason: "UPSTASH not configured; using the shared Postgres limiter" });
    }
    limiters = null;
    return limiters;
  }
  const redis = new Redis({ url, token });
  limiters = new Map(
    (Object.keys(LIMITS) as LimitName[]).map((name) => [
      name,
      new Ratelimit({
        redis,
        prefix: `pa:rl:${name}`,
        limiter: Ratelimit.slidingWindow(LIMITS[name].tokens, LIMITS[name].window),
        analytics: false,
      }),
    ]),
  );
  return limiters;
}

// Last resort (no database either, or it failed): fixed window per instance.
const memory = new Map<string, { count: number; reset: number }>();

function windowMs(w: string): number {
  const [n, unit] = w.split(" ");
  return Number(n) * (unit === "m" ? 60_000 : 1_000);
}

export function memoryLimit(name: LimitName, key: string, now = Date.now()): LimitResult {
  const { tokens, window } = LIMITS[name];
  const k = `${name}:${key}`;
  const entry = memory.get(k);
  if (!entry || entry.reset <= now) {
    const reset = now + windowMs(window);
    memory.set(k, { count: 1, reset });
    return { success: true, limit: tokens, remaining: tokens - 1, reset };
  }
  entry.count += 1;
  return { success: entry.count <= tokens, limit: tokens, remaining: Math.max(0, tokens - entry.count), reset: entry.reset };
}

let dbLimiterReady = true;

/**
 * Fixed-window counter in Postgres, shared by every server instance (a per-instance memory counter
 * is no limit at all on serverless). One atomic upsert per check: a new or expired window restarts at 1.
 */
async function dbLimit(name: LimitName, key: string): Promise<LimitResult | null> {
  if (!dbLimiterReady || !process.env.DATABASE_URL) return null;
  const { tokens, window } = LIMITS[name];
  const ms = windowMs(window);
  try {
    // Loaded on first use, so importing this module (e.g. in unit tests) never opens a database client.
    const { db } = await import("@/lib/db");
    const rows = await db().execute<{ count: number; reset_at: Date | string }>(sql`
      insert into rate_limits (key, count, reset_at)
      values (${`${name}:${key}`}, 1, now() + (${ms} * interval '1 millisecond'))
      on conflict (key) do update set
        count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
        reset_at = case when rate_limits.reset_at <= now() then excluded.reset_at else rate_limits.reset_at end
      returning count, reset_at`);
    const row = rows[0];
    if (!row) return null;
    const count = Number(row.count);
    const reset = new Date(row.reset_at).getTime();
    return { success: count <= tokens, limit: tokens, remaining: Math.max(0, tokens - count), reset };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    // Before migration 0012 is applied the table doesn't exist: stop trying until the next cold start.
    if (/rate_limits/.test(message) && /does not exist/.test(message)) dbLimiterReady = false;
    log.error("ratelimit.db_error", { name, error: message });
    return null;
  }
}

export async function rateLimit(name: LimitName, key: string): Promise<LimitResult> {
  const l = upstash()?.get(name);
  if (l) {
    try {
      const r = await l.limit(key);
      return { success: r.success, limit: r.limit, remaining: r.remaining, reset: r.reset };
    } catch (err) {
      log.error("ratelimit.error", { name, error: err instanceof Error ? err.message : "unknown" });
    }
  }
  return (await dbLimit(name, key)) ?? memoryLimit(name, key);
}

/** Drops counters whose window ended over a day ago (called by the dispatcher). */
export async function pruneRateLimits(): Promise<void> {
  if (!dbLimiterReady || !process.env.DATABASE_URL) return;
  const { db } = await import("@/lib/db");
  await db().execute(sql`delete from rate_limits where reset_at < now() - interval '1 day'`);
}

export function rateLimitResponse(r: LimitResult): Response {
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(Math.max(1, Math.ceil((r.reset - Date.now()) / 1000))),
      "x-ratelimit-limit": String(r.limit),
      "x-ratelimit-remaining": String(r.remaining),
    },
  });
}
