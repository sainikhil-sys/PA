import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutomationBuilder } from "@/components/automations/builder";
import { RunHistory } from "@/components/automations/run-history";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

export const metadata: Metadata = { title: "Automation" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const a = await db().query.automations.findFirst({ where: and(eq(schema.automations.id, id), eq(schema.automations.userId, user.id)) });
  if (!a) notFound();
  const runs = await db().select().from(schema.automationRuns).where(eq(schema.automationRuns.automationId, id)).orderBy(desc(schema.automationRuns.createdAt)).limit(20);
  return (
    <>
      <PageHeader title={a.name} description={a.description || undefined} />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <AutomationBuilder
          initial={{ id: a.id, name: a.name, description: a.description, template: a.template ?? undefined, trigger: a.trigger, conditions: a.conditions, actions: a.actions, permissions: a.permissions, timeoutMs: a.timeoutMs, enabled: a.enabled }}
        />
        <RunHistory automationId={a.id} runs={runs.map((r) => ({ id: r.id, status: r.status, dryRun: r.dryRun, error: r.error, steps: r.steps, createdAt: r.createdAt.toISOString(), attempts: r.attempts }))} />
      </div>
    </>
  );
}
