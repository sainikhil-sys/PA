"use client";

import { Brain } from "@phosphor-icons/react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { deleteMemory, updateMemory } from "@/app/actions/settings";
import type { UiMemory } from "./use-chat";

/**
 * One memory the agent saved from the owner's own message, shown under the reply.
 * Undo removes a new memory, or puts back the previous wording of an updated one.
 */
export function MemoryLine({ memory }: { memory: UiMemory }) {
  const [undone, setUndone] = React.useState(Boolean(memory.undone));
  const [pending, start] = React.useTransition();
  const canUndo = !undone && (memory.status === "saved" || (memory.status === "updated" && memory.previous !== undefined));

  const label = undone
    ? memory.status === "updated"
      ? "Memory change undone"
      : "Removed from memory"
    : memory.status === "exists"
      ? "Already in memory"
      : memory.status === "updated"
        ? "Memory updated"
        : "Saved to memory";

  const undo = () =>
    start(async () => {
      const r = memory.status === "updated" && memory.previous !== undefined ? await updateMemory({ id: memory.id, content: memory.previous }) : await deleteMemory({ id: memory.id });
      if (!r.ok) return void toast.error(r.error);
      setUndone(true);
    });

  return (
    <div className="mt-2 flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] border border-border px-3 py-1.5 text-[12px] text-muted">
      <Brain size={14} aria-hidden className="shrink-0" />
      <span className="font-medium text-foreground">{label}</span>
      <span className={`min-w-0 flex-1 truncate ${undone ? "line-through" : ""}`}>{memory.content}</span>
      {canUndo ? (
        <button type="button" onClick={undo} disabled={pending} className="h-7 rounded-[8px] px-2 font-medium text-foreground hover:bg-surface-hover disabled:opacity-50">
          {pending ? "Undoing" : "Undo"}
        </button>
      ) : null}
      <Link href="/settings/agent" className="h-7 rounded-[8px] px-2 leading-7 hover:bg-surface-hover hover:text-foreground">
        Manage
      </Link>
    </div>
  );
}
