"use client";

import { CheckCircle, ListPlus, PencilSimpleLine } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { generateDraftAction, makeTaskFromEmailAction } from "@/app/actions/email";
import { Button } from "@/components/ui/button";

/** "Draft reply" creates a Gmail DRAFT only — it is never sent. */
export function EmailActions({ id, hasDraft, compact }: { id: string; hasDraft: boolean; compact?: boolean }) {
  const router = useRouter();
  const [drafting, startDraft] = React.useTransition();
  const [tasking, startTask] = React.useTransition();
  const [drafted, setDrafted] = React.useState(hasDraft);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={drafted ? "ghost" : "secondary"}
        disabled={drafting}
        onClick={() =>
          startDraft(async () => {
            const res = await generateDraftAction({ id });
            if (!res.ok) return void toast.error(res.error);
            setDrafted(true);
            toast.success("Draft saved in Gmail", { description: "Review and send it from Gmail when you're ready." });
            router.refresh();
          })
        }
      >
        {drafted ? <CheckCircle /> : <PencilSimpleLine />}
        {drafting ? "Drafting…" : drafted ? (compact ? "Drafted" : "Draft ready") : "Draft reply"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={tasking}
        onClick={() =>
          startTask(async () => {
            const res = await makeTaskFromEmailAction({ id });
            if (!res.ok) return void toast.error(res.error);
            toast.success("Task created");
            router.refresh();
          })
        }
      >
        <ListPlus /> Make task
      </Button>
    </div>
  );
}
