import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunView } from "@/components/flow/run-view";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { flowEvents, flowStatus } from "@/lib/flow/server";

export const metadata: Metadata = { title: "Run" };
export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requireOwner();
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) notFound();
  const [spans, base] = await Promise.all([flowEvents(user.id, { runId }), flowStatus(user.id)]);
  if (!spans.length) notFound();
  return (
    <>
      <PageHeader title="Run" description="How this run moved through your agent, models, sources and the approval gate." />
      <RunView runId={runId} initial={spans} base={base} />
    </>
  );
}
