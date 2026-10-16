"use client";

import { Check, PencilSimple, ShieldCheck, X } from "@phosphor-icons/react";
import { motion } from "motion/react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { approveProposalAction, dismissProposalAction } from "@/app/actions/proposals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UiProposal } from "./use-chat";

/** Confirmation card. The agent proposes; nothing runs until Approve is clicked. */
export function ProposalCard({ proposal, onStatus }: { proposal: UiProposal; onStatus: (status: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(proposal.summary);
  const [when, setWhen] = React.useState("");
  const [pending, start] = React.useTransition();
  const [result, setResult] = React.useState<{ message: string; href?: string } | null>(null);
  const canEditTitle = ["create_task", "schedule_task", "create_linkedin_draft", "add_note"].includes(proposal.kind);
  const done = proposal.status && proposal.status !== "pending";

  const approve = () =>
    start(async () => {
      const res = await approveProposalAction({ id: proposal.id, edits: editing ? { title, when: when || undefined } : undefined });
      if (!res.ok) return void toast.error(res.error);
      setResult(res.data);
      onStatus("executed");
      toast.success(res.data.message);
    });

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="rounded-[14px] border border-border bg-background p-4" role="group" aria-label={`Proposed action: ${proposal.label}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border border-border text-muted">
          <ShieldCheck size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-muted">{proposal.label} · needs your approval</p>
          {editing && canEditTitle ? (
            <div className="mt-2 flex flex-col gap-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" className="h-10 text-sm" />
              {proposal.kind.includes("task") ? <Input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="When? e.g. tomorrow at 5" aria-label="When" className="h-10 text-sm" /> : null}
            </div>
          ) : (
            <p className="mt-0.5 text-sm font-medium">{proposal.summary}</p>
          )}
          {result ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[13px]">
              <Check size={16} /> {result.message}
              {result.href ? (
                <Link href={result.href} className="underline underline-offset-4">
                  Open
                </Link>
              ) : null}
            </p>
          ) : done ? (
            <p className="mt-2 text-[13px] text-muted">{proposal.status === "dismissed" ? "Dismissed" : proposal.status === "failed" ? "Didn't complete" : "Done"}</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={approve} disabled={pending}>
                <Check /> {pending ? "Working…" : "Approve"}
              </Button>
              {canEditTitle ? (
                <Button size="sm" onClick={() => setEditing((e) => !e)} disabled={pending} aria-pressed={editing}>
                  <PencilSimple /> Edit
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await dismissProposalAction({ id: proposal.id });
                    onStatus("dismissed");
                  })
                }
              >
                <X /> Dismiss
              </Button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
