"use client";

import { CalendarBlank, Kanban, ListChecks } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import useSWR from "swr";
import { Switch } from "@/components/ui/misc";
import { ErrorState } from "@/components/ui/states";
import { Segmented } from "@/components/ui/tabs";
import { fetcher } from "@/lib/fetcher";
import { QuickAdd } from "./quick-add";
import { ScheduleView } from "./schedule-view";
import type { TaskRow } from "./task-bits";
import { TaskBoard } from "./task-board";
import { TaskDrawer } from "./task-drawer";
import { TaskList } from "./task-list";

type View = "list" | "board" | "schedule";

export function TasksPage({ initial, timezone }: { initial: TaskRow[]; timezone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (params.get("view") as View) || "list";
  const openId = params.get("task");
  const [showDone, setShowDone] = React.useState(false);
  const [assignee, setAssignee] = React.useState<"all" | "me" | "agent" | "claude">("all");
  const { data, error, mutate } = useSWR<{ items: TaskRow[] }>("/api/tasks", fetcher, { fallbackData: { items: initial }, refreshInterval: 8_000 });

  const setParam = (k: string, v: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (v === null) sp.delete(k);
    else sp.set(k, v);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const tasks = (data?.items ?? []).filter((t) => assignee === "all" || t.assignee === assignee);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          id="tasks-view"
          label="View"
          value={view}
          onChange={(v) => setParam("view", v)}
          options={[
            { value: "list", label: "List", icon: <ListChecks size={16} /> },
            { value: "board", label: "Board", icon: <Kanban size={16} /> },
            { value: "schedule", label: "Schedule", icon: <CalendarBlank size={16} /> },
          ]}
        />
        {view !== "schedule" ? (
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Assignee
              <select value={assignee} onChange={(e) => setAssignee(e.target.value as typeof assignee)} className="h-9 rounded-[10px] border border-border bg-background px-2 text-[13px] text-foreground">
                <option value="all">Everyone</option>
                <option value="me">Me</option>
                <option value="agent">Agent</option>
                <option value="claude">Claude</option>
              </select>
            </label>
            {view === "list" ? (
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <Switch checked={showDone} onCheckedChange={setShowDone} aria-label="Show completed" /> Show done
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
      {view !== "schedule" ? <QuickAdd onAdded={() => void mutate()} /> : null}
      {error ? <ErrorState compact /> : null}
      {view === "list" ? (
        <TaskList tasks={tasks} onOpen={(id) => setParam("task", id)} onChanged={() => void mutate()} showDone={showDone} />
      ) : view === "board" ? (
        <TaskBoard tasks={tasks} onOpen={(id) => setParam("task", id)} onChanged={() => void mutate()} />
      ) : (
        <ScheduleView timezone={timezone} onOpenTask={(id) => setParam("task", id)} />
      )}
      <TaskDrawer id={openId} onClose={() => setParam("task", null)} onChanged={() => void mutate()} />
    </div>
  );
}
