/**
 * Daily token limit maths (configuration key ai.dailyTokenLimitPerUser). Pure, so it is unit tested;
 * lib/ai/gate.ts reads the usage and the setting.
 */

/** The limit in force: null, 0, negative or a non-number means no limit. */
export function effectiveDailyLimit(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

/** True when today's usage has reached the limit, so the next call on the server's AI is refused. */
export function isOverDailyLimit(usedToday: number, limit: unknown): boolean {
  const l = effectiveDailyLimit(limit);
  if (l === null) return false;
  return usedToday >= l;
}

/** Tokens left today, or null when there is no limit. */
export function remainingToday(usedToday: number, limit: unknown): number | null {
  const l = effectiveDailyLimit(limit);
  return l === null ? null : Math.max(0, l - usedToday);
}

/** Start of the current day in UTC: the limit resets at midnight UTC. */
export function utcDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
