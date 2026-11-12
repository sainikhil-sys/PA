"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertNotRestricted } from "@/lib/admin/restrictions";
import { assertCapability } from "@/lib/ai/gate";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { queueRun } from "@/lib/automations/events";
import { nextCronRun } from "@/lib/automations/schedule";
import { usesAi } from "@/lib/automations/templates";
import { automationSchema } from "@/lib/automations/validate";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { getSettings } from "@/lib/db/queries/settings";
import { processJobs } from "@/lib/jobs/handlers";
import { randomToken, sha256 } from "@/lib/security/crypto";

const uuid = z.string().uuid();

async function owned(userId: string, id: string) {
  const a = await db().query.automations.findFirst({ where: and(eq(schema.automations.id, id), eq(schema.automations.userId, userId)) });
  if (!a) throw new UserFacingError("Automation not found.");
  return a;
}

/** Create or update. Webhook triggers get a secret shown ONCE (stored hashed). */
export const saveAutomation = ownerAction(automationSchema, async (input, user) => {
  await assertNotRestricted(user.id, "automations");
  const { timezone } = await getSettings(user.id);
  const nextRunAt = input.trigger.type === "schedule" ? nextCronRun(input.trigger.cron, timezone) : null;
  const values = {
    name: input.name,
    description: input.description,
    template: input.template ?? null,
    trigger: input.trigger,
    conditions: input.conditions,
    actions: input.actions,
    permissions: input.permissions,
    timeoutMs: input.timeoutMs,
    enabled: input.enabled,
    nextRunAt,
  };
  let id = input.id;
  let webhookSecret: string | null = null;
  if (id) {
    const existing = await owned(user.id, id);
    if (input.trigger.type === "webhook" && !existing.webhookSecretHash) {
      webhookSecret = randomToken(24);
      await db().update(schema.automations).set({ ...values, webhookSecretHash: sha256(webhookSecret) }).where(eq(schema.automations.id, id));
    } else {
      await db().update(schema.automations).set(values).where(eq(schema.automations.id, id));
    }
  } else {
    if (input.trigger.type === "webhook") webhookSecret = randomToken(24);
    const [row] = await db()
      .insert(schema.automations)
      .values({ userId: user.id, ...values, webhookSecretHash: webhookSecret ? sha256(webhookSecret) : null })
      .returning({ id: schema.automations.id });
    id = row!.id;
  }
  await logActivity({ userId: user.id, actor: "me", tool: "automation.saved", inputSummary: input.name, outcome: "success" });
  revalidatePath("/automations");
  return { id: id!, webhookSecret };
});

export const toggleAutomation = ownerAction(z.object({ id: uuid, enabled: z.boolean() }), async ({ id, enabled }, user) => {
  const a = await owned(user.id, id);
  const { timezone } = await getSettings(user.id);
  await db()
    .update(schema.automations)
    .set({ enabled, nextRunAt: enabled && a.trigger.type === "schedule" ? nextCronRun(a.trigger.cron, timezone) : a.nextRunAt })
    .where(eq(schema.automations.id, id));
  revalidatePath("/automations");
});

/** Destructive; UI requires a confirm dialog. */
export const deleteAutomation = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  await owned(user.id, id);
  await db().delete(schema.automations).where(eq(schema.automations.id, id));
  await logActivity({ userId: user.id, actor: "me", tool: "automation.deleted", inputSummary: `id=${id}`, outcome: "success" });
  revalidatePath("/automations");
});

/** Test run (real) or dry run (no side effects). Processes immediately for fast feedback. */
export const runAutomationNow = ownerAction(z.object({ id: uuid, dryRun: z.boolean() }), async ({ id, dryRun }, user) => {
  await assertNotRestricted(user.id, "automations");
  const a = await owned(user.id, id);
  if (!dryRun && usesAi(a.actions)) await assertCapability("automations");
  const runId = await queueRun(a, `${dryRun ? "dry" : "test"}:${Date.now()}`, { type: "manual", source: dryRun ? "dry_run" : "test_run", title: "Test event", subject: "Test event", from: "test@example.com", category: "FYI", summary: "Test event" }, dryRun);
  if (!runId) throw new UserFacingError("Couldn't start the run. Try again.");
  await processJobs({ budgetMs: 50_000, types: ["run_automation"], batchSize: 1 });
  revalidatePath(`/automations/${id}`);
  const run = await db().query.automationRuns.findFirst({ where: eq(schema.automationRuns.id, runId) });
  return { runId, status: run?.status ?? "queued" };
});

/** Manual re-run of a dead-lettered run: a fresh run with the same event. */
export const rerunAutomationRun = ownerAction(z.object({ runId: uuid }), async ({ runId }, user) => {
  await assertNotRestricted(user.id, "automations");
  const run = await db().query.automationRuns.findFirst({ where: and(eq(schema.automationRuns.id, runId), eq(schema.automationRuns.userId, user.id)) });
  if (!run) throw new UserFacingError("Run not found.");
  const a = await owned(user.id, run.automationId);
  if (!run.dryRun && usesAi(a.actions)) await assertCapability("automations");
  const id = await queueRun(a, `rerun:${run.id}:${Date.now()}`, run.event, run.dryRun);
  await processJobs({ budgetMs: 50_000, types: ["run_automation"], batchSize: 1 });
  revalidatePath(`/automations/${a.id}`);
  revalidatePath("/automations");
  return { runId: id };
});

/** Re-run a dead-lettered background job (failed status in the jobs table). */
export const rerunJob = ownerAction(z.object({ jobId: uuid }), async ({ jobId }, user) => {
  await db()
    .update(schema.jobs)
    .set({ status: "pending", attempts: 0, runAt: new Date(), lastError: null })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.userId, user.id), eq(schema.jobs.status, "failed")));
  revalidatePath("/automations");
});
