import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { cache } from "react";
import { UserFacingError } from "@/lib/auth/action";
import { getConfigValue } from "@/lib/config/store";
import { db, schema } from "@/lib/db";
import { errMessage, log } from "@/lib/log";
import { errorJson } from "@/lib/security/request";
import { isOverDailyLimit, utcDayStart } from "./limits";
import { AI_DAILY_LIMIT, AI_FEATURE_OFF, type AiCapability } from "./messages";

/**
 * Server-side AI controls from configuration (proposal 4.3 and 5.4): capability switches (ai.chat,
 * ai.voice, ai.research, ai.documents, ai.automations) and the per-person daily token limit
 * (ai.dailyTokenLimitPerUser). These are product switches: admins are not exempt. The console's own
 * provider test calls testProvider directly and is not affected.
 */

export { AI_FEATURE_OFF, type AiCapability };

/** Thrown by the AI router when the person's daily allowance is used up. Its message is safe to show. */
export class AiLimitError extends UserFacingError {
  constructor() {
    super(AI_DAILY_LIMIT);
    this.name = "AiLimitError";
  }
}

/** Off only when the stored value is exactly false; a missing or unreadable setting leaves it on. */
export async function capabilityOn(capability: AiCapability): Promise<boolean> {
  return (await getConfigValue<boolean>(`ai.${capability}`)) !== false;
}

/** For route handlers, after apiGuard: 403 { code: "feature_off" } with a plain message, or null when on. */
export async function capabilityOffResponse(capability: AiCapability): Promise<Response | null> {
  if (await capabilityOn(capability)) return null;
  const message = AI_FEATURE_OFF[capability];
  return errorJson(403, message, { code: "feature_off", message });
}

/** For server actions: throws a message the action wrapper shows as is. */
export async function assertCapability(capability: AiCapability): Promise<void> {
  if (!(await capabilityOn(capability))) throw new UserFacingError(AI_FEATURE_OFF[capability]);
}

/**
 * Tokens this person used today (UTC) on the server's AI. Calls on their own key don't count.
 * One indexed query (ai_runs_user_idx on user_id, created_at), memoized per request.
 */
export const serverTokensToday = cache(async (userId: string): Promise<number> => {
  const [row] = await db()
    .select({ n: sql<string>`coalesce(sum(${schema.aiRuns.inputTokens} + ${schema.aiRuns.outputTokens}), 0)` })
    .from(schema.aiRuns)
    .where(and(eq(schema.aiRuns.userId, userId), gte(schema.aiRuns.createdAt, utcDayStart()), eq(schema.aiRuns.keySource, "server")));
  return Number(row?.n ?? 0);
});

/**
 * True when the person has used today's allowance. Calls without a person (background, system) are
 * never limited. If usage can't be read, the call goes ahead (logged): a database hiccup must not
 * look like a used-up allowance.
 */
export async function dailyLimitReached(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const limit = await getConfigValue<number | null>("ai.dailyTokenLimitPerUser");
  if (!limit) return false;
  try {
    return isOverDailyLimit(await serverTokensToday(userId), limit);
  } catch (err) {
    log.warn("ai.limit_read_failed", { error: errMessage(err) });
    return false;
  }
}

/** For route handlers: 429 { code: "ai_daily_limit" } with the plain message, or null. */
export async function dailyLimitResponse(userId: string): Promise<Response | null> {
  if (!(await dailyLimitReached(userId))) return null;
  return errorJson(429, AI_DAILY_LIMIT, { code: "ai_daily_limit", message: AI_DAILY_LIMIT });
}
