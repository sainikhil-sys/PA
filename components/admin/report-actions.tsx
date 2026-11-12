"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { resolveReport } from "@/app/actions/moderation";
import { Button } from "@/components/ui/button";

type Outcome = "dismiss" | "remove_message" | "disable_account";

const CONFIRM: Record<Exclude<Outcome, "dismiss">, string> = {
  remove_message: "Remove this message for everyone in the chat? This can't be undone.",
  disable_account: "Disable this account? They're signed out everywhere and can't sign in until you enable it on the Users tab.",
};

const DONE: Record<Outcome, string> = {
  dismiss: "Report dismissed",
  remove_message: "Message removed",
  disable_account: "Account disabled",
};

/** The three ways to close an open report. Each asks first when it changes someone else's data. */
export function ReportActions({ reportId, canRemoveMessage, canDisable }: { reportId: string; canRemoveMessage: boolean; canDisable: boolean }) {
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
