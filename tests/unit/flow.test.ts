import { describe, expect, it } from "vitest";
import { makeDemoRun, isDemoRun } from "@/lib/flow/demo";
import { automationDraft } from "@/lib/flow/draft";
import {
  buildPanelState,
  contrast,
  deriveEdgeState,
  deriveNodeStatus,
  mapSpanNode,
  MAX_ANIMATED_EDGES,
  mergeSpans,
  nextCursor,
  NODES,
  panelBacking,
  type FlowSpan,
  type NodeBase,
} from "@/lib/flow/model";
import { pollInterval } from "@/lib/flow/transport";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const base = (over: Partial<NodeBase> = {}): NodeBase => ({ connected: true, enabled: true, lastActivityAt: null, calls1h: 0, errors1h: 0, lastErrorAt: null, permissions: "read-only", ...over });
const quiet = { running: false, lastEventAt: null, dryRun: false, lastOkAt: null };

describe("node status derivation", () => {
  it("is active only from running spans or events inside the window", () => {
    expect(deriveNodeStatus(base(), { ...quiet, running: true }, NOW)).toBe("active");
    expect(deriveNodeStatus(base(), { ...quiet, lastEventAt: NOW - 5_000 }, NOW)).toBe("active");
    expect(deriveNodeStatus(base(), { ...quiet, lastEventAt: NOW - 16_000 }, NOW)).toBe("idle");
    expect(deriveNodeStatus(base(), { ...quiet, lastEventAt: NOW - 25_000 }, NOW, 30_000)).toBe("active");
  });
  it("respects enable flags and connections before anything else", () => {
    expect(deriveNodeStatus(base({ connected: false }), { ...quiet, running: true }, NOW)).toBe("not_connected");
    expect(deriveNodeStatus(base({ enabled: false }), { ...quiet, running: true }, NOW)).toBe("off");
  });
  it("shows waiting, error and dry run", () => {
    expect(deriveNodeStatus(base({ pending: 2 }), quiet, NOW)).toBe("waiting");
    expect(deriveNodeStatus(base({ lastErrorAt: new Date(NOW - 60_000).toISOString() }), quiet, NOW)).toBe("error");
    expect(deriveNodeStatus(base({ lastErrorAt: new Date(NOW - 60_000).toISOString() }), { ...quiet, lastOkAt: NOW - 30_000 }, NOW)).toBe("idle");
    expect(deriveNodeStatus(base(), { ...quiet, lastEventAt: NOW - 1000, dryRun: true }, NOW)).toBe("dry_run");
  });
});

describe("edge state mapping", () => {
  const e = { fromStatus: "idle" as const, toStatus: "idle" as const, lastUsedAt: null, lastStatus: null, running: false };
  it("maps every state", () => {
    expect(deriveEdgeState(e, NOW)).toBe("idle");
    expect(deriveEdgeState({ ...e, lastUsedAt: NOW - 2_000, lastStatus: "ok" }, NOW)).toBe("active");
    expect(deriveEdgeState({ ...e, lastUsedAt: NOW - 40_000, lastStatus: "ok" }, NOW)).toBe("recent");
    expect(deriveEdgeState({ ...e, lastUsedAt: NOW - 90_000, lastStatus: "ok" }, NOW)).toBe("idle");
    expect(deriveEdgeState({ ...e, toStatus: "off" }, NOW)).toBe("disabled");
    expect(deriveEdgeState({ ...e, fromStatus: "not_connected" }, NOW)).toBe("disabled");
    expect(deriveEdgeState({ ...e, lastUsedAt: NOW - 1_000, lastStatus: "error" }, NOW)).toBe("error");
    expect(deriveEdgeState({ ...e, lastUsedAt: NOW - 1_000, lastStatus: "blocked" }, NOW)).toBe("blocked");
  });
});

describe("span → node mapping", () => {
  it("maps tools, sources, actions and triggers", () => {
    expect(mapSpanNode("tool:list_tasks")).toBe("tasks");
    expect(mapSpanNode("tool:list_important_emails")).toBe("gmail");
    expect(mapSpanNode("tool:search_knowledge")).toBe("knowledge");
    expect(mapSpanNode("source:notion")).toBe("notion");
    expect(mapSpanNode("action:create_task")).toBe("output:tasks");
    expect(mapSpanNode("trigger:schedule")).toBe("input:automation");
    expect(mapSpanNode("nonsense")).toBeNull();
  });
});

describe("translucency and contrast", () => {
  it("raises the text backing so muted text stays AA over a black page", () => {
    const b = panelBacking(0.4, true);
    expect(b.panelAlpha).toBe(0.4);
    expect(b.textAlpha).toBeGreaterThan(0.4);
    const v = Math.round(255 * b.textAlpha);
    expect(contrast([0x52, 0x52, 0x5b], [v, v, v])).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps full opacity as-is and clamps the range", () => {
    expect(panelBacking(1, true)).toEqual({ panelAlpha: 1, textAlpha: 1, solid: false });
    expect(panelBacking(0.1, true).panelAlpha).toBe(0.4);
  });
  it("falls back to solid white without backdrop-filter", () => {
    expect(panelBacking(0.5, false)).toEqual({ panelAlpha: 1, textAlpha: 1, solid: true });
  });
});

describe("event cursor", () => {
  const s = (id: string, startedAt: string, endedAt: string | null, status: FlowSpan["status"] = "ok"): FlowSpan => ({ id, runId: "r", runKind: "chat", trigger: "text", node: "agent", label: id, status, meta: {}, startedAt, endedAt });
  it("advances to the latest start/end and never moves backwards", () => {
    expect(nextCursor(null, [s("a", "2026-10-16T10:00:00Z", "2026-10-16T10:00:05Z")])).toBe("2026-10-16T10:00:05Z");
    expect(nextCursor("2026-10-16T11:00:00Z", [s("b", "2026-10-16T10:00:00Z", null)])).toBe("2026-10-16T11:00:00Z");
    expect(nextCursor("2026-10-16T11:00:00Z", [])).toBe("2026-10-16T11:00:00Z");
  });
  it("merges updates by id (running → ok) and caps history", () => {
    const merged = mergeSpans([s("a", "2026-10-16T10:00:00Z", null, "running")], [s("a", "2026-10-16T10:00:00Z", "2026-10-16T10:00:02Z", "ok"), s("b", "2026-10-16T10:00:03Z", null)]);
    expect(merged.map((x) => [x.id, x.status])).toEqual([["a", "ok"], ["b", "ok"]]);
    const many = Array.from({ length: 250 }, (_, i) => s(`x${i}`, new Date(NOW + i * 1000).toISOString(), null));
    expect(mergeSpans([], many, 200)).toHaveLength(200);
  });
  it("polls fast only while something runs, and not at all when closed", () => {
    expect(pollInterval(true, true)).toBe(2000);
    expect(pollInterval(true, false)).toBe(10000);
    expect(pollInterval(false, true)).toBe(0);
  });
});

describe("integration: a chat run touching Gmail and Knowledge", () => {
  const bases = Object.fromEntries(NODES.map((n) => [n.id, base()]));
  const t0 = NOW;
  const at = (ms: number) => new Date(t0 + ms).toISOString();
  const run: FlowSpan[] = [
    { id: "1", runId: "run-1", runKind: "chat", trigger: "text", node: "input:text", label: "You sent a message", status: "ok", meta: {}, startedAt: at(0), endedAt: at(10) },
    { id: "2", runId: "run-1", runKind: "chat", trigger: "text", node: "agent", label: "Planned: gmail, knowledge", status: "ok", meta: {}, startedAt: at(20), endedAt: at(300) },
    { id: "3", runId: "run-1", runKind: "chat", trigger: "text", node: "gmail", label: "Read 12 important emails", status: "ok", meta: { count: 12 }, startedAt: at(310), endedAt: at(600) },
    { id: "4", runId: "run-1", runKind: "chat", trigger: "text", node: "knowledge", label: "Knowledge base returned 4 sources", status: "ok", meta: { count: 4, top: 0.82 }, startedAt: at(610), endedAt: at(900) },
    { id: "5", runId: "run-1", runKind: "chat", trigger: "text", node: "model:smart", label: "Writing the answer", status: "running", meta: {}, startedAt: at(910), endedAt: null },
  ];

  it("lights the right nodes and edges while running", () => {
    const s = buildPanelState({ base: bases, spans: run, now: t0 + 1000, focusRunId: "run-1" });
    const status = Object.fromEntries(s.nodes.map((n) => [n.id, n.status]));
    for (const id of ["input:text", "agent", "gmail", "knowledge", "model:smart"]) expect(status[id]).toBe("active");
    expect(status.calendar).toBe("idle");
    const edge = Object.fromEntries(s.edges.map((e) => [e.id, e.state]));
    expect(edge["input:text->agent"]).toBe("active");
    expect(edge["agent->gmail"]).toBe("active");
    expect(edge["agent->knowledge"]).toBe("active");
    expect(edge["agent->model:smart"]).toBe("active");
    expect(edge["agent->calendar"]).toBe("idle");
    expect(s.edges.find((e) => e.id === "agent->gmail")!.summaries.at(-1)!.label).toBe("Read 12 important emails");
    expect(s.focus?.steps.map((x) => x.n + ":" + x.node)).toEqual(["1:input:text", "2:agent", "3:gmail", "4:knowledge", "5:model:smart"]);
    expect(s.focus?.completed).toBe(4);
    expect(s.counters.active).toBe(5);
    expect(s.feed[0]!.text).toBe("Writing the answer");
    expect(s.anyRunning).toBe(true);
  });

  it("returns to idle (with fading 'recent' links) after the run ends", () => {
    const done = run.map((x) => (x.id === "5" ? { ...x, status: "ok" as const, endedAt: at(1500) } : x));
    const later = buildPanelState({ base: bases, spans: done, now: t0 + 30_000 });
    expect(later.nodes.filter((n) => n.status === "active")).toHaveLength(0);
    expect(later.edges.find((e) => e.id === "agent->gmail")!.state).toBe("recent");
    const muchLater = buildPanelState({ base: bases, spans: done, now: t0 + 120_000 });
    expect(muchLater.edges.every((e) => e.state === "idle")).toBe(true);
    expect(muchLater.anyRunning).toBe(false);
  });

  it("caps animated edges to the most recent eight", () => {
    const burst: FlowSpan[] = ["gmail", "calendar", "tasks", "knowledge", "news", "model:fast", "model:smart", "approval", "output:notify"].map((node, i) => ({
      id: `b${i}`,
      runId: "burst",
      runKind: "chat",
      trigger: "text",
      node,
      label: node,
      status: "ok",
      meta: {},
      startedAt: at(i * 10),
      endedAt: at(i * 10 + 5),
    }));
    const s = buildPanelState({ base: bases, spans: burst, now: t0 + 1000 });
    expect(s.edges.filter((e) => e.state === "active").length).toBeLessThanOrEqual(MAX_ANIMATED_EDGES);
  });

  it("shows Claude's MCP calls coming from the Claude input node", () => {
    const mcp: FlowSpan[] = [
      { id: "c1", runId: "m", runKind: "mcp", trigger: "claude", node: "input:claude", label: "Claude called list_tasks", status: "ok", meta: {}, startedAt: at(0), endedAt: at(1) },
      { id: "c2", runId: "m", runKind: "mcp", trigger: "claude", node: "tool:list_tasks", label: "Claude: List tasks", status: "ok", meta: {}, startedAt: at(2), endedAt: at(50) },
    ];
    const s = buildPanelState({ base: bases, spans: mcp, now: t0 + 500 });
    expect(s.edges.find((e) => e.id === "input:claude->tasks")!.state).toBe("active");
    expect(s.feed[0]!.actor).toBe("Claude");
  });
});

describe("drafts and demo", () => {
  it("previews an automation as dashed draft links", () => {
    const d = automationDraft("Inbox triage", { type: "email", category: "URGENT" }, [{ type: "call_agent", prompt: "x" }, { type: "notify", title: "y" }]);
    expect(d.edges).toEqual(expect.arrayContaining([["input:automation", "agent"], ["agent", "gmail"], ["agent", "model:smart"], ["agent", "output:notify"]]));
    const s = buildPanelState({ base: {}, spans: [], now: NOW, draft: d });
    expect(s.edges.filter((e) => e.draft).length).toBe(d.edges.length);
  });
  it("labels demo runs clearly and never as real runs", () => {
    const demo = makeDemoRun(NOW);
    expect(demo.every((x) => isDemoRun(x.runId) && x.label.startsWith("Demo"))).toBe(true);
  });
});
