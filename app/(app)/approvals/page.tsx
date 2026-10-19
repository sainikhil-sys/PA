import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalList } from "@/components/approvals/approval-list";
import { PageHeader } from "@/components/ui/states";
import { pendingProposals, PROPOSAL_LABEL } from "@/lib/agent/proposals";
import { requireOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { chat: "Chat", voice: "Voice", automation: "Automation", mcp: "Claude" };

/**
 * Everything the agent prepared that waits for your decision: from chat, voice and automations.
 * Nothing here has run yet. Approve runs it once; Dismiss throws it away.
 */
export default async function ApprovalsPage() {
  const user = await requireOwner();
  const [pending, recent] = await Promise.all([
    pendingProposals(user.id, 100),
    db().select().from(schema.proposals).where(and(eq(schema.proposals.userId, user.id), ne(schema.proposals.status, "pending"))).orderBy(desc(schema.proposals.decidedAt)).limit(15),
  ]);
  // Name the automation behind automation-created proposals.
  const runIds = pending.map((p) => p.automationRunId).filter((x): x is string => Boolean(x));
  const runs = runIds.length
    ? await db()
        .select({ runId: schema.automationRuns.id, automationId: schema.automations.id, name: schema.automations.name })
        .from(schema.automationRuns)
        .innerJoin(schema.automations, eq(schema.automations.id, schema.automationRuns.automationId))
        .where(inArray(schema.automationRuns.id, runIds))
    : [];
  const runName = new Map(runs.map((r) => [r.runId, r]));

  return (
    <>
      <PageHeader title="Approvals" description="Things the agent prepared for you. Nothing here has run yet: approve to run it once, or dismiss it." />
      <ApprovalList
        items={pending.map((p) => {
          const run = p.automationRunId ? runName.get(p.automationRunId) : undefined;
          return {
            proposal: { id: p.id, kind: p.kind, label: PROPOSAL_LABEL[p.kind] ?? p.kind, summary: p.summary, status: p.status },
            from: run ? `Automation: ${run.name}` : (SOURCE[p.source] ?? p.source),
            href: run ? `/automations/${run.automationId}` : p.conversationId ? `/chat/${p.conversationId}` : null,
            when: timeAgo(p.createdAt.toISOString()),
          };
        })}
      />
      {recent.length ? (
        <section className="mt-8">
          <h2 className="mb-2 text-[13px] font-medium text-muted">Recently decided</h2>
          <ul className="card divide-y divide-border rounded-[14px] border border-border bg-background">
            {recent.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                <span className={p.status === "executed" || p.status === "approved" ? "text-success" : p.status === "failed" ? "text-danger" : "text-muted"}>●</span>
                <span className="min-w-0 flex-1 truncate">
                  {PROPOSAL_LABEL[p.kind] ?? p.kind}: {p.summary}
                </span>
                <span className="shrink-0 capitalize text-muted">{p.status}</span>
                <span className="shrink-0 text-[12px] text-subtle">{p.decidedAt ? timeAgo(p.decidedAt.toISOString()) : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="mt-6 text-[12px] text-subtle">
        Automations that need a decision send their proposals here. Manage automations in <Link href="/automations" className="underline">Automations</Link>.
      </p>
    </>
  );
}
