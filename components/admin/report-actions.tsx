"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { resolveReport } from "@/app/actions/moderation";
import { Button } from "@/components/ui/button";

type Outcome = "dismiss" | "remove_message" | "remove_content" | "disable_account";

const CONFIRM: Record<Exclude<Outcome, "dismiss">, string> = {
  remove_message: "Remove this message for everyone in the chat? This can't be undone.",
  remove_content: "Take this down for everyone? The author will see it as removed.",
  disable_account: "Disable this account? They're signed out everywhere and can't sign in until you enable it on the Users tab.",
};

const DONE: Record<Outcome, string> = {
  dismiss: "Report dismissed",
  remove_message: "Message removed",
  remove_content: "Taken down",
  disable_account: "Account disabled",
};

/** The ways to close an open report (only those that fit it are shown). Each asks first when it changes someone else's data. */
export function ReportActions({ reportId, canRemoveMessage, canRemoveContent = false, canDisable }: { reportId: string; canRemoveMessage: boolean; canRemoveContent?: boolean; canDisable: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const act = (outcome: Outcome) =>
    start(async () => {
      if (outcome !== "dismiss" && !window.confirm(CONFIRM[outcome])) return;
      const r = await resolveReport({ reportId, outcome });
      if (!r.ok) return void toast.error(r.error);
      toast.success(DONE[outcome]);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-1.5">
      {canRemoveMessage ? (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => act("remove_message")}>
          Remove message
        </Button>
      ) : null}
      {canRemoveContent ? (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => act("remove_content")}>
          Take down
        </Button>
      ) : null}
      {canDisable ? (
        <Button size="sm" variant="danger" disabled={pending} onClick={() => act("disable_account")}>
          Disable account
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("dismiss")}>
        Dismiss
      </Button>
    </div>
  );
}
