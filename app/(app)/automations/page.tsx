import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { AutomationList, type AutomationCard } from "@/components/automations/automation-list";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { describeCron } from "@/lib/automations/schedule";
import { TEMPLATES, TRIGGER_LABEL } from "@/lib/automations/templates";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/db/queries/settings";

export const metadata: Metadata = { title: "Automations" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AutomationsPage() {
  const user = await requireOwner();
  const [autos, runs, deadJobs, s] = await Promise.all([
    db().select().from(schema.automations).where(eq(schema.automations.userId, user.id)).orderBy(desc(schema.automations.createdAt)),
    db().select().from(schema.automationRuns).where(eq(schema.automationRuns.userId, user.id)).orderBy(desc(schema.automationRuns.createdAt)).limit(200),
    db().select().from(schema.jobs).where(and(eq(schema.jobs.userId, user.id), eq(schema.jobs.status, "failed"))).orderBy(desc(schema.jobs.updatedAt)).limit(10),
    getSettings(user.id),
  ]);
  const names = new Map(autos.map((a) => [a.id, a.name]));
  const items: AutomationCard[] = autos.map((a) => {
    const last = runs.find((r) => r.automationId === a.id);
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      enabled: a.enabled,
      triggerLabel: TRIGGER_LABEL[a.trigger.type],
      schedule: a.trigger.type === "schedule" ? describeCron(a.trigger.cron) : null,
      lastRun: last ? { status: last.status, at: last.createdAt.toISOString(), dryRun: last.dryRun } : null,
      nextRunAt: a.nextRunAt?.toISOString() ?? null,
    };
  });
  // Dead letters: latest failed run per automation that hasn't since succeeded.
  const deadRuns = autos
    .map((a) => runs.find((r) => r.automationId === a.id))
    .filter((r): r is NonNullable<typeof r> => r?.status === "dead")
    .map((r) => ({ id: r.id, automationId: r.automationId, name: names.get(r.automationId) ?? "Automation", error: r.error, at: r.createdAt.toISOString() }));

  return (
    <>
      <PageHeader title="Automations" description="Trigger → conditions → actions. Automations only take the actions you allow, never send email from your Gmail, and never delete. Anything the agent suggests beyond that goes to your approval queue." />
      <AutomationList
        items={items}
        paused={s.automationsPaused}
        deadRuns={deadRuns}
        deadJobs={deadJobs.map((j) => ({ id: j.id, type: j.type, error: j.lastError, at: j.updatedAt.toISOString() }))}
        templates={TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description }))}
      />
    </>
  );
}
