import { z } from "zod";

/**
 * Server environment. Parsed lazily so `next build` works without secrets;
 * each accessor throws a clear error only when the value is actually needed.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().optional(),
  // Auth
  ALLOWED_EMAILS: z.string().optional(),
  ALLOWED_EMAIL: z.string().optional(),
  /** "open": anyone with an email can sign up. "allowlist" (default): only ALLOWED_EMAILS. */
  SIGNUP_MODE: z.enum(["open", "allowlist"]).default("allowlist"),
  /** Admins get Telegram alerts and system mail. Defaults to ALLOWED_EMAILS. */
  ADMIN_EMAILS: z.string().optional(),
  AUTH_SECRET: z.string().min(32).optional(),
  OTP_TEST_MODE: z.enum(["true", "false"]).optional(),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  // Data
  DATABASE_URL: z.string().optional(),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  // Google integration (Gmail, Calendar, Drive)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // AI
  AI_BASE_URL: z.string().url().optional(),
  AI_API_KEY: z.string().optional(),
  FAST_MODEL: z.string().optional(),
  SMART_MODEL: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  AI_FALLBACK_BASE_URL: z.string().url().optional(),
  AI_FALLBACK_API_KEY: z.string().optional(),
  AI_FALLBACK_FAST_MODEL: z.string().optional(),
  AI_FALLBACK_SMART_MODEL: z.string().optional(),
  OLLAMA_BASE_URL: z.string().url().optional(),
  OLLAMA_MODEL: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  AI_MOCK: z.enum(["true", "false"]).optional(),
  // Voice
  STT_BASE_URL: z.string().url().optional(),
  STT_API_KEY: z.string().optional(),
  STT_MODEL: z.string().optional(),
  TTS_BASE_URL: z.string().url().optional(),
  TTS_API_KEY: z.string().optional(),
  TTS_MODEL: z.string().optional(),
  TTS_VOICE: z.string().optional(),
  // News
  NEWS_FEEDS: z.string().optional(),
  NEWS_API_KEY: z.string().optional(),
  // Notifications
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  // Platform
  VERCEL: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    // Treat empty strings as unset so `.env` placeholders don't fail validation.
    const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
    cached = schema.parse(raw);
  }
  return cached;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${String(key)}`);
  }
  return value as NonNullable<Env[K]>;
}

/** Public base URL of the deployment, e.g. https://pa.example.com (no trailing slash). */
export function appUrl(): string {
  const e = env();
  if (e.APP_URL) return e.APP_URL.replace(/\/$/, "");
  if (e.VERCEL_PROJECT_PRODUCTION_URL) return `https://${e.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

/** Emails allowed to sign in when SIGNUP_MODE=allowlist. ALLOWED_EMAILS takes a comma list. */
export function allowedEmails(): string[] {
  const e = env();
  return emailList(e.ALLOWED_EMAILS ?? e.ALLOWED_EMAIL);
}

/** True when anyone may create an account. */
export function signupOpen(): boolean {
  return env().SIGNUP_MODE === "open";
}

function emailList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Admin accounts (Telegram alerts go only to these). Falls back to the allowlist. */
export function adminEmails(): string[] {
  const e = env();
  return e.ADMIN_EMAILS ? emailList(e.ADMIN_EMAILS) : allowedEmails();
}

export const isProd = () => env().NODE_ENV === "production";
export const isOnVercel = () => Boolean(env().VERCEL);

/**
 * Test mode (fixed OTP code, mock AI) is refused on Vercel production no matter what.
 */
export function isTestMode(): boolean {
  const e = env();
  if (e.VERCEL_ENV === "production") return false;
  return e.OTP_TEST_MODE === "true";
}

/** Test-only: reset the parsed cache. */
export function __resetEnvCache() {
  cached = undefined;
}
