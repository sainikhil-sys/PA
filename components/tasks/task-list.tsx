"use client";

import { CheckSquare } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";
import { toggleTaskDone } from "@/app/actions/tasks";
import { Checkbox } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/states";
import { STATUS_LABEL } from "@/lib/tasks/transitions";
import { cn } from "@/lib/utils";
import { AssigneeBadge, DurationMark, PriorityMark, RecurringMark, ReminderMark, type TaskRow } from "./task-bits";

export function TaskList({ tasks, onOpen, onChanged, showDone }: { tasks: TaskRow[]; onOpen: (id: string) => void; onChanged: () => void; showDone: boolean }) {
  const top = tasks.filter((t) => !t.parentId && (showDone || t.status !== "done"));
  const subCount = (id: string) => tasks.filter((t) => t.parentId === id);
  if (!top.length) return <EmptyState icon={CheckSquare} title="No tasks here" description="Add one above in plain words, like “every Monday 9am review inbox”." />;
  return (
    <ul className="divide-y divide-border rounded-[16px] border border-border">
      <AnimatePresence initial={false}>
        {top.map((t) => {
          const subs = subCount(t.id);
          return (
            <motion.li key={t.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex min-h-14 items-center gap-3 px-4 py-2">
              <Checkbox
                checked={t.status === "done"}
                aria-label={`${t.status === "done" ? "Reopen" : "Complete"} ${t.title}`}
                onCheckedChange={async (v) => {
                  const res = await toggleTaskDone({ id: t.id, done: Boolean(v) });
                  if (!res.ok) toast.error(res.error);
                  onChanged();
                }}
              />
              <button type="button" onClick={() => onOpen(t.id)} className="flex min-w-0 flex-1 flex-col items-start gap-1 py-1 text-left">
                <span className={cn("max-w-full truncate text-sm", t.status === "done" && "text-muted line-through")}>{t.title}</span>
                <span className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  {t.status !== "todo" && t.status !== "done" ? <span>{STATUS_LABEL[t.status]}</span> : null}
                  {t.dueDate ? <span className="tabular">Due {t.dueDate}</span> : null}
                  {t.scheduledAt ? <span className="tabular">{new Date(t.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span> : null}
                  <DurationMark minutes={t.durationMinutes} />
                  <ReminderMark remindAt={t.remindAt} scheduledAt={t.scheduledAt} reminderSentAt={t.reminderSentAt} />
                  {subs.length ? <span className="tabular">{subs.filter((s) => s.status === "done").length}/{subs.length} subtasks</span> : null}
                  {t.tags.map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {t.recurrence ? <RecurringMark /> : null}
                <PriorityMark priority={t.priority} />
                {t.assignee !== "me" ? <AssigneeBadge assignee={t.assignee} status={t.status} /> : null}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
