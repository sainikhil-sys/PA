import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Automation, AutomationTrigger } from "@/lib/db/schema";
import { getSettings } from "@/lib/db/queries/settings";
import { enqueue } from "@/lib/jobs/queue";
import { matchesTrigger, type AutomationEvent } from "./match";

/**
 * Event-triggered automations. Each event has a stable key so the same event
 * never starts the same automation twice (unique run_key per automation).
 */
export async function emitEvent(userId: string, event: AutomationEvent) {
  const settings = await getSettings(userId);
  if (settings.automationsPaused) return 0;
  const candidates = await db()
    .select()
    .from(schema.automations)
    .where(and(eq(schema.automations.userId, userId), eq(schema.automations.enabled, true)));
  let started = 0;
  for (const a of candidates) {
    if (!matchesTrigger(a.trigger, event)) continue;
    if (await queueRun(a, `${event.type}:${event.key}`, event as unknown as Record<string, unknown>, false)) started++;
  }
  return started;
}

/** Create a queued run (idempotent on runKey) and enqueue its job. Returns the run id or null if it already existed. */
export async function queueRun(a: Automation, runKey: string, event: Record<string, unknown>, dryRun: boolean): Promise<string | null> {
  const [run] = await db()
    .insert(schema.automationRuns)
    .values({ userId: a.userId, automationId: a.id, runKey, dryRun, event, status: "queued" })
    .onConflictDoNothing()
    .returning({ id: schema.automationRuns.id });
  if (!run) return null;
  await enqueue(a.userId, "run_automation", { runId: run.id }, { dedupeKey: `automation-run:${run.id}`, maxAttempts: 3 });
  return run.id;
}

export function emitTaskStatusChange(userId: string, taskId: string, to: string) {
  return emitEvent(userId, { type: "task_status", key: `${taskId}:${to}:${Math.floor(Date.now() / 60_000)}`, taskId, to });
}

export type { AutomationTrigger };
