"use client";

import { Check, Square, Timer } from "@phosphor-icons/react";
import Link from "next/link";
import * as React from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/states";
import { fetcher } from "@/lib/fetcher";
import type { FocusDay } from "@/lib/focus/stats";
import { formatMinutes } from "@/lib/tasks/timing";
import { cn } from "@/lib/utils";

type Recent = { id: string; startedAt: string; endedAt: string; plannedMinutes: number; actualMinutes: number; completed: boolean; taskId: string | null; taskTitle: string | null };
export type FocusData = { today: { minutes: number; sessions: number }; days: FocusDay[]; recent: Recent[] };

const TRACK = 32;

/** Today's focus total, a 7-day bar strip and the history sheet. */
export function FocusStats() {
  const { data, error } = useSWR<FocusData>("/api/focus", fetcher, { refreshInterval: 60_000 });
  const [open, setOpen] = React.useState(false);

  if (error && !data) return <p className="text-[12px] text-muted">History unavailable</p>;
  if (!data) return <Skeleton className="h-10" />;

  const max = Math.max(25, ...data.days.map((d) => d.minutes));
  const { minutes, sessions } = data.today;
  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="tabular text-[13px]">{sessions ? `Today ${formatMinutes(minutes)} · ${sessions} ${sessions === 1 ? "session" : "sessions"}` : "No focus yet today"}</p>
          <Button size="sm" variant="quiet" className="-ml-3 mt-1" onClick={() => setOpen(true)}>
            History
          </Button>
        </div>
        <div className="flex shrink-0 items-end gap-1.5" aria-hidden>
          {data.days.map((d, i) => {
            const today = i === data.days.length - 1;
            const h = d.minutes > 0 ? Math.max(2, Math.round((d.minutes / max) * TRACK)) : 0;
            return (
              <div key={d.date} className="flex w-4 flex-col items-center gap-1">
                <div className="flex w-full items-end" style={{ height: TRACK }}>
                  <div className={cn("w-full rounded-[2px]", today ? "bg-foreground" : "bg-border-strong")} style={{ height: h }} />
                </div>
                <span className={cn("text-[11px]", today ? "font-medium text-foreground" : "text-subtle")}>{d.label.slice(0, 1)}</span>
              </div>
            );
          })}
        </div>
        <ul className="sr-only">
          {data.days.map((d) => (
            <li key={d.date}>
              {d.label}: {d.minutes} minutes
            </li>
          ))}
        </ul>
      </div>
      <FocusHistory open={open} onOpenChange={setOpen} recent={data.recent} />
    </>
  );
}

function FocusHistory({ open, onOpenChange, recent }: { open: boolean; onOpenChange: (o: boolean) => void; recent: Recent[] }) {
  const groups = React.useMemo(() => {
    const m = new Map<string, Recent[]>();
    for (const r of recent) {
      const key = new Date(r.startedAt).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
      m.set(key, [...(m.get(key) ?? []), r]);
    }
    return [...m.entries()];
  }, [recent]);
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Focus history" description="Your last 7 days.">
      {!recent.length ? (
        <EmptyState icon={Timer} title="No sessions yet" description="Start the timer to build a history." />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([day, rows]) => (
            <section key={day}>
              <h3 className="mb-2 text-sm font-medium">{day}</h3>
              <ul className="flex flex-col divide-y divide-border rounded-[12px] border border-border">
                {rows.map((r) => (
                  <li key={r.id} className="flex min-h-11 flex-col gap-0.5 px-3 py-2 text-[13px]">
                    <span className="flex items-center justify-between gap-3">
                      <span className="tabular text-muted">
                        {time(r.startedAt)} to {time(r.endedAt)}
                      </span>
                      <span className="tabular">{formatMinutes(r.actualMinutes)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1 text-muted">
                        {r.completed ? <Check size={14} aria-hidden /> : <Square size={14} aria-hidden />}
                        {r.completed ? "Completed" : "Stopped early"}
                      </span>
                      {r.taskId && r.taskTitle ? (
                        <Link href={`/tasks?task=${r.taskId}`} className="min-w-0 truncate underline underline-offset-4">
                          {r.taskTitle}
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
