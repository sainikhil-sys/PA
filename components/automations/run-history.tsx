"use client";

import { ArrowClockwise, CaretDown, CheckCircle, Circle, Flask, Lock, Play, WarningCircle } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { rerunAutomationRun, runAutomationNow } from "@/app/actions/automations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import type { RunStep } from "@/lib/db/schema";
import { timeAgo } from "@/lib/utils";

type Run = { id: string; status: string; dryRun: boolean; error: string | null; steps: RunStep[]; createdAt: string; attempts: number };

const STEP_ICON: Record<RunStep["status"], typeof Circle> = { ok: CheckCircle, dry_run: Flask, skipped: Circle, error: WarningCircle, queued_for_approval: Lock };
const LABEL: Record<string, string> = { succeeded: "Succeeded", dead: "Failed", failed: "Skipped", running: "Running", queued: "Queued" };

export function RunHistory({ automationId, runs }: { automationId: string; runs: Run[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState<string | null>(runs[0]?.id ?? null);
  const [pending, start] = React.useTransition();
  const go = (dryRun: boolean) =>
    start(async () => {
      const res = await runAutomationNow({ id: automationId, dryRun });
      if (!res.ok) return void toast.error(res.error);
      setOpen(res.data.runId);
      router.refresh();
    });
  return (
    <Card className="h-fit xl:sticky xl:top-24">
      <CardHeader
        title="Run history"
        description="Step-by-step logs and outputs"
        action={
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => go(true)}>
              <Flask /> Dry run
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(false)}>
              <Play /> Test
            </Button>
          </div>
        }
      />
      <div className="px-5 pb-5">
        {runs.length === 0 ? (
          <EmptyState compact icon={Play} title="No runs yet" description="Try a dry run to see what would happen, with no side effects." />
        ) : (
          <ol className="flex flex-col gap-2" aria-live="polite">
            {runs.map((r) => (
              <li key={r.id} className="rounded-[12px] border border-border">
                <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} className="flex min-h-12 w-full items-center gap-2 px-3 text-left">
                  <Badge variant={r.status === "dead" ? "solid" : r.status === "succeeded" ? "soft" : r.status === "failed" ? "dashed" : "outline"}>{LABEL[r.status] ?? r.status}</Badge>
                  {r.dryRun ? <Badge variant="dashed">Dry run</Badge> : null}
                  <span className="ml-auto text-[12px] text-muted">{timeAgo(r.createdAt)}</span>
                  <CaretDown size={14} className={`text-subtle transition-transform ${open === r.id ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence initial={false}>
                  {open === r.id ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="border-t border-border px-3 py-3">
                      <ol className="flex flex-col gap-2.5">
                        {r.steps.map((st, i) => {
                          const Icon = STEP_ICON[st.status];
                          return (
                            <li key={i} className="flex gap-2 text-[13px]">
                              <Icon size={16} className="mt-0.5 shrink-0 text-muted" weight={st.status === "ok" ? "fill" : "regular"} aria-label={st.status} />
                              <div className="min-w-0">
                                <p>{st.message}</p>
                                {st.output ? <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-muted">{st.output}</p> : null}
                              </div>
                            </li>
                          );
                        })}
                        {r.steps.length === 0 ? <li className="text-[13px] text-muted">Waiting to start…</li> : null}
                      </ol>
                      {r.error ? <p className="mt-3 text-[13px]">{r.error}</p> : null}
                      {r.status === "dead" ? (
                        <Button
                          size="sm"
                          className="mt-3"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const res = await rerunAutomationRun({ runId: r.id });
                              if (!res.ok) toast.error(res.error);
                              router.refresh();
                            })
                          }
                        >
                          <ArrowClockwise /> Re-run
                        </Button>
                      ) : null}
                      {r.attempts > 1 ? <p className="mt-2 text-[11px] text-subtle">Attempts: {r.attempts}</p> : null}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
