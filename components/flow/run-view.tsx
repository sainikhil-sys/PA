"use client";

import { ArrowLeft, Graph } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as React from "react";
import useSWR from "swr";
import { useLinkPanel } from "@/components/flow/link-panel-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { buildPanelState, mapSpanNode, NODE_BY_ID, type FlowSpan, type NodeBase } from "@/lib/flow/model";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

const FlowMap = dynamic(() => import("./flow-graph").then((m) => m.FlowMap), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

const STATUS_TEXT: Record<string, string> = { ok: "Done", running: "Running", error: "Failed", blocked: "Blocked", waiting: "Waiting for you", dry_run: "Dry run" };

/** Full-size run view. Uses the same node/edge components as the panel ("full" variant). */
export function RunView({ runId, initial, base }: { runId: string; initial: FlowSpan[]; base: Record<string, NodeBase> }) {
  const { data } = useSWR<{ spans: FlowSpan[] }>(`/api/flow/events?run=${runId}`, fetcher, { fallbackData: { spans: initial }, refreshInterval: (d) => (d?.spans.some((s) => s.status === "running") ? 2000 : 0) });
  const { openPanel } = useLinkPanel();
  const spans = data?.spans ?? initial;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, []);
  // Show the run as it happened: evaluate "now" at the run's end so its path is lit.
  const end = Math.max(...spans.map((s) => Date.parse(s.endedAt ?? s.startedAt)));
  const state = React.useMemo(() => buildPanelState({ base, spans, now: spans.some((s) => s.status === "running") ? now : end + 1000, focusRunId: runId }), [base, spans, now, end, runId]);
  const focusIds = new Set(state.focus?.steps.map((s) => s.node));
  const first = spans[0];
  const duration = first ? Math.max(0, end - Date.parse(first.startedAt)) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild size="sm" variant="quiet">
          <Link href="/flow">
            <ArrowLeft /> All runs
          </Link>
        </Button>
        <Button size="sm" onClick={() => openPanel({ runId })}>
          <Graph /> Show in panel
        </Button>
      </div>
      <dl className="flex flex-wrap gap-6 text-[13px]">
        <div>
          <dt className="text-muted">Started by</dt>
          <dd className="capitalize">{first ? `${first.runKind === "mcp" ? "Claude" : first.runKind} · ${first.trigger}` : "Unknown"}</dd>
        </div>
        <div>
          <dt className="text-muted">Steps</dt>
          <dd className="tabular">{state.focus?.total ?? 0}</dd>
        </div>
        <div>
          <dt className="text-muted">Duration</dt>
          <dd className="tabular">{(duration / 1000).toFixed(1)}s</dd>
        </div>
      </dl>
      <Card className="h-[460px] overflow-hidden p-2">
        <FlowMap nodes={state.nodes} edges={state.edges} variant="full" focusIds={focusIds} animate={false} now={now} />
      </Card>
      <section aria-labelledby="steps">
        <h2 id="steps" className="mb-3 text-[15px] font-medium">
          Steps
        </h2>
        <ol className="flex flex-col divide-y divide-border rounded-[16px] border border-border">
          {spans.map((s, i) => {
            const node = mapSpanNode(s.node);
            return (
              <li key={s.id} className="flex items-start gap-3 px-4 py-3">
                <span className="tabular grid size-6 shrink-0 place-items-center rounded-full border border-foreground text-[11px]">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{s.label}</p>
                  <p className="text-[12px] text-muted">
                    {node ? NODE_BY_ID.get(node)?.label : s.node} · {new Date(s.startedAt).toLocaleTimeString()}
                    {s.endedAt ? ` · ${((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000).toFixed(2)}s` : ""}
                    {Object.keys(s.meta).length ? ` · ${Object.entries(s.meta).map(([k, v]) => `${k}: ${v}`).join(", ")}` : ""}
                  </p>
                </div>
                <span className={cn("shrink-0 text-[12px]", s.status === "error" ? "text-danger" : "text-muted")}>{STATUS_TEXT[s.status] ?? s.status}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
