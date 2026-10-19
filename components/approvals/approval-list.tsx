"use client";

import { CheckCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ProposalCard } from "@/components/chat/proposal-card";
import type { UiProposal } from "@/components/chat/use-chat";

type Item = { proposal: UiProposal; from: string; href: string | null; when: string };

/** Pending approvals, each with the same approve / edit / dismiss card used in chat. */
export function ApprovalList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [decided, setDecided] = React.useState<Set<string>>(new Set());
  const open = items.filter((i) => !decided.has(i.proposal.id));

  if (!items.length || !open.length) {
    return (
      <div className="card flex flex-col items-center gap-2 rounded-[16px] border border-border bg-background px-4 py-12 text-center">
        <CheckCircle size={28} className="text-muted" />
        <p className="text-sm font-medium">Nothing waiting for you</p>
        <p className="max-w-sm text-[13px] text-muted">When the agent or an automation wants to create a task, a draft or a post, it asks here first.</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => (
        <li key={i.proposal.id} className="flex flex-col gap-1">
          <p className="flex items-center gap-1.5 px-1 text-[12px] text-muted">
            {i.href ? (
              <Link href={i.href} className="hover:text-foreground hover:underline">
                {i.from}
              </Link>
            ) : (
              i.from
            )}
            <span aria-hidden>·</span>
            {i.when}
          </p>
          <ProposalCard
            proposal={i.proposal}
            onStatus={(status) => {
              if (status !== "pending") {
                setDecided((d) => new Set(d).add(i.proposal.id));
                setTimeout(() => router.refresh(), 1200);
              }
            }}
          />
        </li>
      ))}
    </ul>
  );
}
