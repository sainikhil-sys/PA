"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { decideVerification } from "@/app/actions/admin-business";
import { Button } from "@/components/ui/button";
import { useConfirm } from "./confirm";

/** Approve or reject one verification request; asks first, records the decision in the audit log. */
export function VerificationDecision({ verificationId, orgName, domainMatches }: { verificationId: string; orgName: string; domainMatches: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [note, setNote] = React.useState("");
  const [pending, start] = React.useTransition();
  const decide = (decision: "approved" | "rejected") =>
    start(async () => {
      const ok = await confirm({
        title: decision === "approved" ? `Verify ${orgName}?` : `Reject ${orgName}?`,
        message: decision === "approved" ? "It can then post requirements, send quotes and approve deals. This is recorded in the audit log." : "The organization can ask again later. This is recorded in the audit log.",
        confirmLabel: decision === "approved" ? "Verify" : "Reject",
        danger: decision === "rejected",
      });
      if (!ok) return;
      const r = await decideVerification({ verificationId, decision, note });
      if (!r.ok) return void toast.error(r.error);
      toast.success(decision === "approved" ? "Verified" : "Rejected");
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[12px] text-muted" htmlFor={`note-${verificationId}`}>
        Note (optional, kept with the decision)
      </label>
      <input id={`note-${verificationId}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="h-9 rounded-[10px] border border-border bg-background px-2 text-[13px]" />
      <span className="flex gap-1.5">
        <Button size="sm" variant="primary" disabled={pending || !domainMatches} onClick={() => decide("approved")}>
          Verify
        </Button>
        <Button size="sm" variant="danger" disabled={pending} onClick={() => decide("rejected")}>
          Reject
        </Button>
      </span>
    </div>
  );
}
