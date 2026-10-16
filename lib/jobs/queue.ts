import "server-only";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, rowsOf, schema } from "@/lib/db";
import type { Job } from "@/lib/db/schema";
import { errMessage } from "@/lib/log";
import { nextRunAt, shouldRetry } from "./backoff";

export type JobType =
  | "sync_inbox"
  | "classify_emails"
  | "daily_briefing"
  | "run_automation"
  | "fetch_news"
  | "suggest_ideas"
  | "knowledge_sync"
  | "reminders";

/** Enqueue a job. With a dedupeKey, a duplicate pending/running job is silently skipped. */
export async function enqueue(
  userId: string,
  type: JobType,
  payload: Record<string, unknown> = {},
  opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {},
) {
  const rows = await db()
    .insert(schema.jobs)
    .values({
      userId,
      type,
      payload,
      dedupeKey: opts.dedupeKey ?? null,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .onConflictDoNothing()
    .returning({ id: schema.jobs.id });
  return rows[0]?.id ?? null;
}

/**
 * Atomically claim a small batch of due jobs. SKIP LOCKED lets overlapping
 * cron invocations run safely without double-processing.
 */
export async function claimBatch(limit: number, types?: JobType[]): Promise<Job[]> {
  const typeFilter = types?.length
    ? sql`and type in (${sql.join(
        types.map((t) => sql`${t}`),
        sql`, `,
      )})`
    : sql``;
  const result = await db().execute(sql`
    update jobs set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
    where id in (
      select id from jobs
      where status = 'pending' and run_at <= now() ${typeFilter}
      order by run_at
      limit ${limit}
      for update skip locked
    )
    returning id
  `);
  const ids = rowsOf<{ id: string }>(result).map((r) => r.id);
  if (!ids.length) return [];
  return db().select().from(schema.jobs).where(inArray(schema.jobs.id, ids));
}

export async function markSucceeded(job: Job) {
  await db()
    .update(schema.jobs)
    .set({ status: "succeeded", lockedAt: null, lastError: null })
    .where(eq(schema.jobs.id, job.id));
}

export async function markFailed(job: Job, err: unknown) {
  const retry = shouldRetry(job.attempts, job.maxAttempts);
  await db()
    .update(schema.jobs)
    .set({
      status: retry ? "pending" : "failed",
      runAt: retry ? nextRunAt(job.attempts) : job.runAt,
      lockedAt: null,
      lastError: errMessage(err).slice(0, 500),
    })
    .where(eq(schema.jobs.id, job.id));
}

/** Jobs stuck in "running" (function timed out / crashed) go back to pending. */
export async function recoverStaleJobs(olderThanMs = 10 * 60_000) {
  await db()
    .update(schema.jobs)
    .set({ status: "pending", lockedAt: null, lastError: "Recovered after timeout" })
    .where(and(eq(schema.jobs.status, "running"), lt(schema.jobs.lockedAt, new Date(Date.now() - olderThanMs))));
}

export async function queueStats(userId: string) {
  const rows = await db()
    .select({ status: schema.jobs.status, n: sql<number>`count(*)::int` })
    .from(schema.jobs)
    .where(eq(schema.jobs.userId, userId))
    .groupBy(schema.jobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<Job["status"], number>>;
}
