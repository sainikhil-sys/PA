import type { FlowSpan } from "./model";

/**
 * "Example run" for the panel — clearly labelled DEMO data, generated in the
 * browser and never written to the database or mixed into real counts.
 */
export const DEMO_PREFIX = "demo-";

export function makeDemoRun(now: number): FlowSpan[] {
  const runId = `${DEMO_PREFIX}${now}`;
  const steps: [string, string, FlowSpan["status"], number][] = [
    ["input:text", "You sent a message", "ok", 0],
    ["agent", "Planned: gmail, knowledge", "ok", 300],
    ["gmail", "Read 12 important emails", "ok", 700],
    ["knowledge", "Knowledge base returned 4 sources", "ok", 1100],
    ["model:smart", "Answer written", "ok", 1900],
    ["approval", "Create Gmail draft: waiting for you", "waiting", 2300],
  ];
  return steps.map(([node, label, status, offset], i) => ({
    id: `${runId}-${i}`,
    runId,
    runKind: "chat",
    trigger: "demo",
    node,
    label: `Demo · ${label}`,
    status,
    meta: {},
    startedAt: new Date(now + offset).toISOString(),
    endedAt: new Date(now + offset + 250).toISOString(),
  }));
}

export const isDemoRun = (runId: string) => runId.startsWith(DEMO_PREFIX);
