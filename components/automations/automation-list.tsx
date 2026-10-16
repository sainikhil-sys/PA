"use client";

import { ArrowClockwise, Flask, Lightning, Play, Plus, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { rerunAutomationRun, rerunJob, runAutomationNow, toggleAutomation } from "@/app/actions/automations";
import { savePreferences } from "@/app/actions/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/states";
import { timeAgo } from "@/lib/utils";

export type AutomationCard = { id: string; name: string; description: string; enabled: boolean; triggerLabel: string; schedule: string | null; lastRun: { status: string; at: string; dryRun: boolean } | null; nextRunAt: string | null };
export type DeadRun = { id: string; automationId: string; name: string; error: string | null; at: string };
export type DeadJob = { id: string; type: string; error: string | null; at: string };

const STATUS: Record<string, { label: string; variant: "solid" | "outline" | "soft" | "dashed" }> = {
  succeeded: { label: "Succeeded", variant: "soft" },
  failed: { label: "Skipped", variant: "dashed" },
  dead: { label: "Failed", variant: "solid" },
  running: { label: "Running", variant: "outline" },
  queued: { label: "Queued", variant: "outline" },
};

export function AutomationList({ items, paused, deadRuns, deadJobs, templates }: { items: AutomationCard[]; paused: boolean; deadRuns: DeadRun[]; deadJobs: DeadJob[]; templates: { id: string; name: string; description: string }[] }) {
  const router = useRouter();
  const [isPaused, setPaused] = React.useState(paused);
  const [pending, start] = React.useTransition();

  const run = (id: string, dryRun: boolean) =>
    start(async () => {
      const res = await runAutomationNow({ id, dryRun });
      if (!res.ok) return void toast.error(res.error);
      toast.success(dryRun ? "Dry run finished" : "Test run finished", { description: `Status: ${STATUS[res.data.status]?.label ?? res.data.status}`, action: { label: "View", onClick: () => router.push(`/automations/${id}`) } });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-8">
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">{isPaused ? "All automations are paused" : "Automations are running"}</p>
          <p className="text-[13px] text-muted">Pausing stops every scheduled and event-triggered run. Dry runs still work.</p>
        </div>
        <label className="flex items-center gap-3 text-sm">
          Pause all
          <Switch
            checked={isPaused}
            onCheckedChange={(v) =>
              start(async () => {
                setPaused(v);
                const res = await savePreferences({ automationsPaused: v });
                if (!res.ok) {
                  setPaused(!v);
                  toast.error(res.error);
                } else toast.success(v ? "All automations paused" : "Automations resumed");
              })
            }
            aria-label="Pause all automations"
          />
        </label>
      </Card>

      {deadRuns.length || deadJobs.length ? (
        <section aria-labelledby="dead-letter">
          <h2 id="dead-letter" className="mb-3 flex items-center gap-2 text-[15px] font-medium">
            <Warning size={18} /> Needs attention
          </h2>
          <ul className="divide-y divide-border rounded-[16px] border border-border">
            {deadRuns.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/automations/${r.automationId}`} className="text-sm font-medium hover:underline">
                    {r.name}
                  </Link>
                  <p className="text-[13px] text-muted">
                    {r.error ?? "Failed"} · {timeAgo(r.at)}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await rerunAutomationRun({ runId: r.id });
                      if (!res.ok) toast.error(res.error);
                      else toast.success("Re-run started");
                      router.refresh();
                    })
                  }
                >
                  <ArrowClockwise /> Re-run
                </Button>
              </li>
            ))}
            {deadJobs.map((j) => (
              <li key={j.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Background job: {j.type.replace(/_/g, " ")}</p>
                  <p className="text-[13px] text-muted">
                    {j.error ?? "Failed"} · {timeAgo(j.at)}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await rerunJob({ jobId: j.id });
                      toast.success("Queued again");
                      router.refresh();
                    })
                  }
                >
                  <ArrowClockwise /> Re-run
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="your-automations">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="your-automations" className="text-[15px] font-medium">
            Your automations
          </h2>
          <Button asChild variant="primary" size="sm">
            <Link href="/automations/new">
              <Plus /> New automation
            </Link>
          </Button>
        </div>
        {items.length === 0 ? (
          <Card>
            <EmptyState icon={Lightning} title="No automations yet" description="Start from a template below, or build one from scratch." action={<Button asChild><Link href="/automations/new">Create one</Link></Button>} />
          </Card>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {items.map((a) => (
              <li key={a.id}>
                <Card className="flex h-full flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/automations/${a.id}`} className="text-[15px] font-medium hover:underline">
                        {a.name}
                      </Link>
                      <p className="mt-0.5 text-[13px] text-muted">{a.schedule ?? a.triggerLabel}</p>
                    </div>
                    <Switch
                      checked={a.enabled}
                      aria-label={`${a.enabled ? "Disable" : "Enable"} ${a.name}`}
                      onCheckedChange={(v) =>
                        start(async () => {
                          const res = await toggleAutomation({ id: a.id, enabled: v });
                          if (!res.ok) toast.error(res.error);
                          router.refresh();
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                    {a.lastRun ? (
                      <>
                        <Badge variant={STATUS[a.lastRun.status]?.variant ?? "soft"}>{a.lastRun.dryRun ? "Dry run · " : ""}{STATUS[a.lastRun.status]?.label ?? a.lastRun.status}</Badge>
                        <span>{timeAgo(a.lastRun.at)}</span>
                      </>
                    ) : (
                      <span>Never run</span>
                    )}
                    {a.nextRunAt && a.enabled && !isPaused ? <span>· next {new Date(a.nextRunAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
                  </div>
                  <div className="mt-auto flex gap-2">
                    <Button size="sm" disabled={pending} onClick={() => run(a.id, true)}>
                      <Flask /> Dry run
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(a.id, false)}>
                      <Play /> Test run
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="templates">
        <h2 id="templates" className="mb-3 text-[15px] font-medium">
          Templates
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <li key={t.id}>
              <Link href={`/automations/new?template=${t.id}`} className="flex h-full flex-col gap-1 rounded-[16px] border border-border p-5 transition-colors hover:border-border-strong">
                <span className="text-sm font-medium">{t.name}</span>
                <span className="text-[13px] text-muted">{t.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
