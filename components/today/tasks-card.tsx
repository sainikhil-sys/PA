"use client";

import { ArrowRight, CheckSquare, Robot, Sparkle } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { toggleTaskDone } from "@/app/actions/tasks";
import { QuickAdd } from "@/components/tasks/quick-add";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/states";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

type T = { id: string; title: string; priority: number; dueDate: string | null; assignee: string; status: string };
type Data = { priorities: T[]; review: T[] };

const PRIORITY = ["", "Low", "Medium", "High"];

/** Live (SWR 10s) task card: top priorities with checkboxes + results needing review. */
export function TasksCardClient({ initial }: { initial: Data }) {
  const { data, mutate } = useSWR<Data>("/api/tasks/today", fetcher, { fallbackData: initial, refreshInterval: 10_000 });
  const [done, setDone] = React.useState<Set<string>>(new Set());
  const d = data ?? initial;

  const toggle = async (t: T) => {
    setDone((s) => new Set(s).add(t.id));
    const res = await toggleTaskDone({ id: t.id, done: true });
    if (!res.ok) {
      toast.error(res.error);
      setDone((s) => {
        const n = new Set(s);
        n.delete(t.id);
        return n;
      });
      return;
    }
    toast.success("Done", {
      action: {
        label: "Undo",
        onClick: async () => {
          await toggleTaskDone({ id: t.id, done: false });
          setDone((s) => {
            const n = new Set(s);
            n.delete(t.id);
            return n;
          });
          void mutate();
        },
      },
    });
    setTimeout(() => void mutate(), 600);
  };

  const open = d.priorities.filter((t) => !done.has(t.id));

  return (
    <Card className="h-full">
      <CardHeader
        title="Top priorities"
        icon={<CheckSquare size={20} />}
        action={
          <Button asChild size="sm" variant="quiet">
            <Link href="/tasks">
              All <ArrowRight />
            </Link>
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-4">
        <QuickAdd compact onAdded={() => void mutate()} />
        {open.length === 0 && d.review.length === 0 ? (
          <EmptyState compact icon={CheckSquare} title="All clear" description="Add a task above, e.g. “call Ravi tomorrow at 5”." />
        ) : (
          <ul className="flex flex-col">
            <AnimatePresence initial={false}>
              {open.map((t) => (
                <motion.li key={t.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.18 }} className="flex min-h-11 items-center gap-3">
                  <Checkbox aria-label={`Complete ${t.title}`} checked={done.has(t.id)} onCheckedChange={() => toggle(t)} />
                  <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                  {t.priority >= 2 ? <span className={cn("text-[11px]", t.priority === 3 ? "font-medium" : "text-muted")}>{PRIORITY[t.priority]}</span> : null}
                  {t.dueDate ? <span className="tabular text-[12px] text-subtle">{t.dueDate.slice(5)}</span> : null}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {d.review.length ? (
          <div className="rounded-[12px] border border-dashed border-border-strong p-3">
            <p className="mb-2 text-[12px] font-medium text-muted">Completed by agent or Claude · needs your review</p>
            <ul className="flex flex-col gap-1">
              {d.review.map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks?task=${t.id}`} className="flex h-10 items-center gap-2 rounded-[8px] px-1 text-sm hover:bg-surface-hover">
                    {t.assignee === "claude" ? <Sparkle size={16} className="text-muted" /> : <Robot size={16} className="text-muted" />}
                    <span className="truncate">{t.title}</span>
                    <ArrowRight size={14} className="ml-auto text-subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
