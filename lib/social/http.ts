import "server-only";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import type { User } from "@/lib/db/schema";
import { errMessage, log } from "@/lib/log";
import { fail, noStore, readJson } from "@/lib/mobile/http";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { SocialError } from "./service";

export const uuidSchema = z.string().uuid("That item no longer exists.");

/**
 * Route wrapper for /api/social: signed-in check, an extra per-person limit on writes, input
 * parsing with zod, and SocialError messages passed through as sentences.
 */
export async function handle(req: Request, fn: (user: User) => Promise<unknown>): Promise<Response> {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  if (req.method !== "GET") {
    const rl = await rateLimit("social", `user:${g.user.id}`);
    if (!rl.success) return rateLimitResponse(rl);
  }
  try {
    const out = await fn(g.user);
    return Response.json(out ?? { ok: true }, { headers: noStore });
  } catch (err) {
    if (err instanceof SocialError) return fail(err.status, err.message);
    if (err instanceof BadInput) return fail(400, err.message);
    // Drizzle wraps database errors ("Failed query: ..."); the cause has Postgres's own message.
    const cause = (err as { cause?: unknown }).cause;
    log.error("social.route_failed", { path: new URL(req.url).pathname, error: errMessage(err).slice(0, 200), cause: cause ? errMessage(cause) : null });
    return fail(500, "Chats is having trouble right now. Try again in a minute.");
  }
}

class BadInput extends Error {}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new BadInput(parsed.error.issues[0]?.message ?? "Something in that request wasn't valid.");
  return parsed.data;
}

export function param<T extends z.ZodType>(value: unknown, schema: T): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadInput(parsed.error.issues[0]?.message ?? "Something in that request wasn't valid.");
  return parsed.data;
}

export type IdParams = { params: Promise<{ id: string }> };
