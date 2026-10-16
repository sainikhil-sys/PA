"use client";

import { Plus } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { quickAddTask } from "@/app/actions/tasks";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Natural-language quick add: "every Monday 9am review inbox", "call Ravi tomorrow at 5 #sales !high". */
export function QuickAdd({ compact, onAdded }: { compact?: boolean; onAdded?: (id: string) => void }) {
  const [value, setValue] = React.useState("");
  const [pending, start] = React.useTransition();
  const submit = () =>
    start(async () => {
      if (!value.trim()) return;
      const res = await quickAddTask(value);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Task added", { description: res.summary });
      setValue("");
      onAdded?.(res.id);
    });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="relative"
    >
      <label htmlFor={compact ? "quick-add-compact" : "quick-add"} className="sr-only">
        Add a task
      </label>
      <Plus size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
      <input
        id={compact ? "quick-add-compact" : "quick-add"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        placeholder={compact ? "Add a task…" : "Add a task — try “every Monday 9am review inbox” or “call Ravi tomorrow at 5”"}
        className={cn(inputClass, "pl-10", compact && "h-10 text-sm")}
        autoComplete="off"
      />
    </form>
  );
}
