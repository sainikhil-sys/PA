import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { log } from "@/lib/log";

export type LimitName = "mcp" | "api" | "auth" | "oauth" | "ai" | "otpEmail" | "otpIp" | "otpVerify" | "webhook";

/** Requests per window. Tuned for a single user plus Claude. */
const LIMITS: Record<LimitName, { tokens: number; window: `${number} s` | `${number} m` }> = {
  mcp: { tokens: 120, window: "1 m" },
  api: { tokens: 300, window: "1 m" },
  auth: { tokens: 20, window: "1 m" },
  oauth: { tokens: 30, window: "1 m" },
  ai: { tokens: 30, window: "1 m" },
  otpEmail: { tokens: 5, window: "15 m" },
  otpIp: { tokens: 20, window: "15 m" },
  otpVerify: { tokens: 10, window: "15 m" },
  webhook: { tokens: 60, window: "1 m" },
};

export type LimitResult = { success: boolean; limit: number; remaining: number; reset: number };

let limiters: Map<LimitName, Ratelimit> | null | undefined;

function upstash(): Map<LimitName, Ratelimit> | null {
  if (limiters !== undefined) return limiters;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      log.warn("ratelimit.fallback", { reason: "UPSTASH not configured; using per-instance memory limiter" });
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

// Fallback for local dev: fixed window per instance.
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

export async function rateLimit(name: LimitName, key: string): Promise<LimitResult> {
  const l = upstash()?.get(name);
  if (!l) return memoryLimit(name, key);
  try {
    const r = await l.limit(key);
    return { success: r.success, limit: r.limit, remaining: r.remaining, reset: r.reset };
  } catch (err) {
    // Fail open on limiter outage, but log it.
    log.error("ratelimit.error", { name, error: err instanceof Error ? err.message : "unknown" });
    return memoryLimit(name, key);
  }
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
