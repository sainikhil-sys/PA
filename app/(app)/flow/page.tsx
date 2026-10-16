import { Graph } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { recentRuns } from "@/lib/flow/server";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Flow" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { chat: "Chat", voice: "Voice", automation: "Automation", mcp: "Claude", job: "Background" };

export default async function FlowPage() {
  const user = await requireOwner();
  const runs = await recentRuns(user.id, 40);
  return (
    <>
      <PageHeader title="Flow" description="Every run, step by step: what triggered it, which sources it touched, and what's waiting for you." />
      {runs.length === 0 ? (
        <EmptyState icon={Graph} title="No runs yet" description="Send a chat message or run an automation, then come back to see its path." />
      ) : (
        <ul className="divide-y divide-border rounded-[16px] border border-border">
          {runs.map((r) => (
            <li key={r.runId}>
              <Link href={`/flow/${r.runId}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-surface sm:flex-row sm:items-center sm:gap-4">
                <span className="text-sm font-medium">{KIND[r.runKind] ?? r.runKind}</span>
                <span className="text-[13px] text-muted">via {r.trigger}</span>
                <span className="tabular text-[13px] text-muted">{r.steps} steps</span>
                <span className="flex gap-2 sm:ml-auto">
                  {r.running ? <Badge variant="outline">Running</Badge> : null}
                  {r.errors ? <Badge variant="solid">{r.errors} failed</Badge> : null}
                  <span className="text-[12px] text-subtle">{timeAgo(r.startedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
