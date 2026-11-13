"use client";

import * as React from "react";
import { revealAnonymousAuthor } from "@/app/actions/admin-anonymous";
import { Button } from "@/components/ui/button";
import { useConfirm } from "./confirm";

/**
 * Admins with anonymous.reveal: see which account wrote a reported anonymous post. Needs a reason,
 * asks first, and every reveal is written to the audit log.
 */
export function RevealAuthor({ reportId }: { reportId: string }) {
  const confirm = useConfirm();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [who, setWho] = React.useState<{ email: string | null; handle: string | null } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  if (who) return <span>{who.handle ? `@${who.handle} · ` : ""}{who.email ?? "Deleted account"}</span>;
  if (!open)
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Anonymous author</span>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Reveal author
        </Button>
      </span>
    );
  const reveal = () =>
    start(async () => {
      setError(null);
      const ok = await confirm({ title: "Reveal who wrote this?", message: "This is recorded in the audit log with your reason. Only reveal an author when you need to act on the account.", confirmLabel: "Reveal" });
      if (!ok) return;
      const r = await revealAnonymousAuthor({ reportId, reason });
      if (!r.ok) return setError(r.error);
      setWho(r.data);
    });
  return (
    <span className="flex flex-col gap-1.5">
      <label className="text-[12px] text-muted" htmlFor={`reveal-${reportId}`}>
        Why do you need to know? (saved in the audit log)
      </label>
      <input id={`reveal-${reportId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="h-9 rounded-[10px] border border-border bg-background px-2 text-[13px]" />
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
      <span className="flex gap-1.5">
        <Button size="sm" variant="primary" disabled={pending || reason.trim().length < 10} onClick={reveal}>
          Reveal
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </span>
    </span>
  );
}
