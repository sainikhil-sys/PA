/**
 * Flow model (pure, unit tested). Shared by the Live Link panel and the Flow
 * run view. Everything is derived from recorded trace spans and real
 * connection state — nothing here invents activity.
 */

export const LANES = ["Inputs", "Agent core", "Models", "Tools & sources", "Approval gate", "Outputs"] as const;
export type Lane = 0 | 1 | 2 | 3 | 4 | 5;

export type NodeId = string;
export type NodeDef = { id: NodeId; label: string; lane: Lane; logo?: string; icon?: string; settingsHref?: string };

export const NODES: NodeDef[] = [
  { id: "input:text", label: "Chat", lane: 0, icon: "chat", settingsHref: "/chat" },
  { id: "input:voice", label: "Voice", lane: 0, icon: "voice" },
  { id: "input:claude", label: "Claude (MCP)", lane: 0, logo: "claude", settingsHref: "/settings/claude" },
  { id: "input:automation", label: "Automations", lane: 0, icon: "automation", settingsHref: "/automations" },
  { id: "agent", label: "Agent", lane: 1, icon: "agent", settingsHref: "/settings/agent" },
  { id: "model:fast", label: "Fast model", lane: 2, icon: "model", settingsHref: "/settings/agent" },
  { id: "model:smart", label: "Smart model", lane: 2, icon: "model", settingsHref: "/settings/agent" },
  { id: "model:embed", label: "Embeddings", lane: 2, icon: "model", settingsHref: "/settings/agent" },
  { id: "gmail", label: "Gmail", lane: 3, logo: "gmail", settingsHref: "/integrations" },
  { id: "calendar", label: "Calendar", lane: 3, logo: "googlecalendar", settingsHref: "/integrations" },
  { id: "tasks", label: "Tasks", lane: 3, icon: "tasks", settingsHref: "/tasks" },
  { id: "knowledge", label: "Knowledge", lane: 3, icon: "knowledge", settingsHref: "/knowledge" },
  { id: "news", label: "News", lane: 3, icon: "news", settingsHref: "/settings/notifications" },
  { id: "drive", label: "Drive", lane: 3, logo: "googledrive", settingsHref: "/knowledge" },
  { id: "notion", label: "Notion", lane: 3, logo: "notion", settingsHref: "/knowledge" },
  { id: "slack", label: "Slack", lane: 3, logo: "slack", settingsHref: "/knowledge" },
  { id: "github", label: "GitHub", lane: 3, logo: "github", settingsHref: "/knowledge" },
  { id: "approval", label: "Approval gate", lane: 4, icon: "approval", settingsHref: "/chat" },
  { id: "output:draft", label: "Gmail drafts", lane: 5, logo: "gmail", settingsHref: "/inbox" },
  { id: "output:tasks", label: "New tasks", lane: 5, icon: "tasks", settingsHref: "/tasks" },
  { id: "output:content", label: "LinkedIn drafts", lane: 5, icon: "content", settingsHref: "/content" },
  { id: "output:notes", label: "Notes", lane: 5, icon: "knowledge", settingsHref: "/knowledge" },
  { id: "output:notify", label: "Notifications", lane: 5, icon: "notify", settingsHref: "/settings/notifications" },
];

export const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));

/** Display column (lane) override: knowledge sources sit left of Knowledge so their links flow left→right. */
export function displayColumn(n: NodeDef): number {
  return ["drive", "notion", "slack", "github"].includes(n.id) ? 2 : n.lane;
}

/** Configured links. Edge id = `${from}->${to}`. */
export const EDGES: [NodeId, NodeId][] = [
  ["input:text", "agent"],
  ["input:voice", "agent"],
  ["input:automation", "agent"],
  ["input:claude", "tasks"],
  ["input:claude", "knowledge"],
  ["input:claude", "gmail"],
  ["input:claude", "calendar"],
  ["agent", "model:fast"],
  ["agent", "model:smart"],
  ["agent", "gmail"],
  ["agent", "calendar"],
  ["agent", "tasks"],
  ["agent", "knowledge"],
  ["agent", "news"],
  ["model:embed", "knowledge"],
  ["drive", "knowledge"],
  ["notion", "knowledge"],
  ["slack", "knowledge"],
  ["github", "knowledge"],
  ["agent", "approval"],
  ["approval", "output:draft"],
  ["approval", "output:tasks"],
  ["approval", "output:content"],
  ["approval", "output:notes"],
  ["agent", "output:notify"],
];
export const edgeId = (from: NodeId, to: NodeId) => `${from}->${to}`;
const EDGE_SET = new Set(EDGES.map(([a, b]) => edgeId(a, b)));

/** Map a recorded span's node name onto a graph node. */
export function mapSpanNode(node: string): NodeId | null {
  if (NODE_BY_ID.has(node)) return node;
  if (node.startsWith("trigger:")) return "input:automation";
  if (node.startsWith("source:")) {
    const s = node.slice(7);
    return s === "gmail" ? "gmail" : NODE_BY_ID.has(s) ? s : "knowledge";
  }
  if (node.startsWith("tool:")) {
    const t = node.slice(5);
    if (/task/.test(t)) return "tasks";
    if (/email/.test(t)) return "gmail";
    if (/briefing/.test(t)) return "calendar";
    if (/memory|note|knowledge/.test(t)) return "knowledge";
    return "tasks";
  }
  if (node.startsWith("action:")) {
    const a = node.slice(7);
    return (
      { create_task: "output:tasks", create_draft: "output:draft", notify: "output:notify", call_webhook: "output:notify", create_linkedin_draft: "output:content", add_note: "output:notes", call_agent: "agent", generate_briefing: "agent" } as Record<string, NodeId>
    )[a] ?? null;
  }
  return null;
}

export type SpanStatus = "running" | "ok" | "error" | "blocked" | "waiting" | "dry_run";
export type FlowSpan = {
  id: string;
  runId: string;
  runKind: string;
  trigger: string;
  node: string;
  label: string;
  status: SpanStatus;
  meta: Record<string, string | number | boolean | null>;
  startedAt: string;
  endedAt: string | null;
};

/** Which node a span's data came from (the edge it travelled along). */
export function sourceFor(target: NodeId, run: { runKind: string; nodes: Set<NodeId> }): NodeId | null {
  const def = NODE_BY_ID.get(target);
  if (!def) return null;
  const input = run.runKind === "mcp" ? "input:claude" : run.runKind === "voice" ? "input:voice" : run.runKind === "automation" ? "input:automation" : "input:text";
  if (def.lane === 0) return null;
  if (target === "agent") return input;
  if (["drive", "notion", "slack", "github"].includes(target)) return null; // syncs start at the source
  if (target === "model:embed") return null; // embeddings are computed during ingest/search, not a hop
  if (run.runKind === "mcp" && EDGE_SET.has(edgeId("input:claude", target))) return "input:claude";
  if (def.lane === 5) return target === "output:notify" ? "agent" : run.nodes.has("approval") ? "approval" : "approval";
  if (target === "approval") return "agent";
  return "agent";
}

// ---------- Node status ----------
export type NodeStatus = "active" | "idle" | "off" | "not_connected" | "waiting" | "error" | "dry_run";
export const STATUS_LABEL: Record<NodeStatus, string> = {
  active: "Active",
  idle: "Idle",
  off: "Off",
  not_connected: "Connect",
  waiting: "Waiting for you",
  error: "Needs attention",
  dry_run: "Dry run",
};

export type NodeBase = {
  connected: boolean;
  enabled: boolean;
  lastActivityAt: string | null;
  calls1h: number;
  errors1h: number;
  lastErrorAt: string | null;
  permissions: "read-only" | "read/write" | "drafts only" | "notify only" | "n/a";
  pending?: number;
};

export const DEFAULT_ACTIVE_WINDOW_MS = 15_000;

/**
 * Strict derivation: "active" only from running spans or events within the
 * window; "off" from the owner's enable flags; "idle" when connected but quiet.
 */
export function deriveNodeStatus(
  base: Pick<NodeBase, "connected" | "enabled" | "lastErrorAt" | "pending">,
  live: { running: boolean; lastEventAt: number | null; dryRun: boolean; lastOkAt: number | null },
  now: number,
  windowMs = DEFAULT_ACTIVE_WINDOW_MS,
): NodeStatus {
  if (!base.connected) return "not_connected";
  if (!base.enabled) return "off";
  if (live.running || (live.lastEventAt !== null && now - live.lastEventAt < windowMs)) return live.dryRun ? "dry_run" : "active";
  if ((base.pending ?? 0) > 0) return "waiting";
  const errAt = base.lastErrorAt ? Date.parse(base.lastErrorAt) : null;
  if (errAt !== null && now - errAt < 10 * 60_000 && (live.lastOkAt === null || live.lastOkAt < errAt)) return "error";
  return "idle";
}

// ---------- Edge state ----------
export type EdgeState = "idle" | "active" | "recent" | "disabled" | "error" | "blocked";
export const RECENT_MS = 60_000;

export function deriveEdgeState(
  e: { fromStatus: NodeStatus; toStatus: NodeStatus; lastUsedAt: number | null; lastStatus: SpanStatus | null; running: boolean },
  now: number,
  windowMs = DEFAULT_ACTIVE_WINDOW_MS,
): EdgeState {
  const offish = (s: NodeStatus) => s === "off" || s === "not_connected";
  if (offish(e.fromStatus) || offish(e.toStatus)) return "disabled";
  const age = e.lastUsedAt === null ? Infinity : now - e.lastUsedAt;
  if (e.lastStatus === "blocked" && age < RECENT_MS * 10) return "blocked";
  if (e.lastStatus === "error" && age < RECENT_MS * 10) return "error";
  if (e.running || age < windowMs) return "active";
  if (age < RECENT_MS) return "recent";
  return "idle";
}

// ---------- Panel state ----------
export type PanelNode = NodeDef & NodeBase & { status: NodeStatus; lastEventAt: number | null; step?: number; inFocus?: boolean };
export type PanelEdge = { id: string; from: NodeId; to: NodeId; state: EdgeState; lastUsedAt: number | null; draft?: boolean; summaries: { label: string; at: string }[] };
export type FeedItem = { id: string; runId: string; text: string; actor: string; trigger: string; node: NodeId | null; status: SpanStatus; at: string };
export type RunFocus = { runId: string; runKind: string; trigger: string; steps: { n: number; node: NodeId; label: string; status: SpanStatus }[]; completed: number; total: number; running: boolean };
export type Counters = { active: number; idle: number; off: number; issues: number };
export type PanelState = { nodes: PanelNode[]; edges: PanelEdge[]; counters: Counters; feed: FeedItem[]; focus: RunFocus | null; anyRunning: boolean };

export const MAX_ANIMATED_EDGES = 8;

const t = (iso: string | null) => (iso ? Date.parse(iso) : null);

function actorFor(runKind: string): string {
  return runKind === "mcp" ? "Claude" : runKind === "automation" ? "Automation" : runKind === "job" ? "Background sync" : "Agent";
}

/** Draft plans (e.g. an automation being edited) render as dashed edges/nodes. */
export type DraftPlan = { label: string; edges: [NodeId, NodeId][] };

export function buildPanelState(input: {
  base: Record<NodeId, NodeBase>;
  spans: FlowSpan[];
  now: number;
  windowMs?: number;
  focusRunId?: string | null;
  draft?: DraftPlan | null;
}): PanelState {
  const { now } = input;
  const windowMs = input.windowMs ?? DEFAULT_ACTIVE_WINDOW_MS;
  const spans = [...input.spans].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  // Live activity per node and per edge.
  const live = new Map<NodeId, { running: boolean; lastEventAt: number | null; dryRun: boolean; lastOkAt: number | null }>();
  const edgeLive = new Map<string, { lastUsedAt: number; lastStatus: SpanStatus; running: boolean; summaries: { label: string; at: string }[] }>();
  const runNodes = new Map<string, Set<NodeId>>();
  for (const s of spans) {
    const node = mapSpanNode(s.node);
    if (!node) continue;
    (runNodes.get(s.runId) ?? runNodes.set(s.runId, new Set()).get(s.runId)!).add(node);
  }
  for (const s of spans) {
    const node = mapSpanNode(s.node);
    if (!node) continue;
    const at = t(s.endedAt) ?? t(s.startedAt)!;
    const cur = live.get(node) ?? { running: false, lastEventAt: null, dryRun: false, lastOkAt: null };
    const running = s.status === "running" && now - t(s.startedAt)! < 5 * 60_000;
    live.set(node, {
      running: cur.running || running,
      lastEventAt: Math.max(cur.lastEventAt ?? 0, at),
      dryRun: s.status === "dry_run" ? true : at >= (cur.lastEventAt ?? 0) ? false : cur.dryRun,
      lastOkAt: s.status === "ok" ? Math.max(cur.lastOkAt ?? 0, at) : cur.lastOkAt,
    });
    const from = sourceFor(node, { runKind: s.runKind, nodes: runNodes.get(s.runId) ?? new Set() });
    if (from) {
      const id = edgeId(from, node);
      const e = edgeLive.get(id) ?? { lastUsedAt: 0, lastStatus: "ok" as SpanStatus, running: false, summaries: [] };
      edgeLive.set(id, { lastUsedAt: Math.max(e.lastUsedAt, at), lastStatus: s.status, running: e.running || running, summaries: [...e.summaries, { label: s.label, at: s.endedAt ?? s.startedAt }].slice(-5) });
    }
  }

  // Focus run: the requested one (pinned/followed) — numbered steps in order.
  let focus: RunFocus | null = null;
  if (input.focusRunId) {
    const rs = spans.filter((s) => s.runId === input.focusRunId);
    if (rs.length) {
      const steps: RunFocus["steps"] = [];
      for (const s of rs) {
        const node = mapSpanNode(s.node);
        if (!node) continue;
        const existing = steps.find((x) => x.node === node);
        if (existing) {
          existing.status = s.status;
          existing.label = s.label;
        } else steps.push({ n: steps.length + 1, node, label: s.label, status: s.status });
      }
      const running = rs.some((s) => s.status === "running");
      focus = { runId: input.focusRunId, runKind: rs[0]!.runKind, trigger: rs[0]!.trigger, steps, completed: steps.filter((x) => x.status !== "running").length, total: steps.length, running };
    }
  }
  const focusNodes = new Map(focus?.steps.map((s) => [s.node, s.n]) ?? []);

  const nodes: PanelNode[] = NODES.map((def) => {
    const base: NodeBase = input.base[def.id] ?? { connected: true, enabled: true, lastActivityAt: null, calls1h: 0, errors1h: 0, lastErrorAt: null, permissions: "n/a" };
    const l = live.get(def.id) ?? { running: false, lastEventAt: null, dryRun: false, lastOkAt: null };
    const lastActivity = Math.max(l.lastEventAt ?? 0, t(base.lastActivityAt) ?? 0) || null;
    return {
      ...def,
      ...base,
      lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
      status: deriveNodeStatus(base, l, now, windowMs),
      lastEventAt: l.lastEventAt,
      step: focusNodes.get(def.id),
      inFocus: focus ? focusNodes.has(def.id) : undefined,
    };
  });
  const statusOf = new Map(nodes.map((n) => [n.id, n.status]));

  let edges: PanelEdge[] = EDGES.map(([from, to]) => {
    const id = edgeId(from, to);
    const l = edgeLive.get(id);
    return {
      id,
      from,
      to,
      lastUsedAt: l?.lastUsedAt ?? null,
      summaries: l?.summaries ?? [],
      state: deriveEdgeState({ fromStatus: statusOf.get(from)!, toStatus: statusOf.get(to)!, lastUsedAt: l?.lastUsedAt ?? null, lastStatus: l?.lastStatus ?? null, running: l?.running ?? false }, now, windowMs),
    };
  });
  // Throttle: only the 8 most recently used edges animate; others show as "recent".
  const active = edges.filter((e) => e.state === "active").sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
  const keep = new Set(active.slice(0, MAX_ANIMATED_EDGES).map((e) => e.id));
  edges = edges.map((e) => (e.state === "active" && !keep.has(e.id) ? { ...e, state: "recent" as EdgeState } : e));

  if (input.draft?.edges.length) {
    for (const [from, to] of input.draft.edges) {
      const id = edgeId(from, to);
      const existing = edges.find((e) => e.id === id);
      if (existing) existing.draft = true;
      else edges.push({ id, from, to, state: "idle", lastUsedAt: null, draft: true, summaries: [] });
    }
  }

  const counters: Counters = { active: 0, idle: 0, off: 0, issues: 0 };
  for (const n of nodes) {
    if (n.status === "active" || n.status === "dry_run") counters.active++;
    else if (n.status === "idle") counters.idle++;
    else if (n.status === "off" || n.status === "not_connected") counters.off++;
    else counters.issues++; // error + waiting need you
  }

  const feed: FeedItem[] = spans
    .slice(-20)
    .reverse()
    .map((s) => ({ id: s.id, runId: s.runId, text: s.label, actor: actorFor(s.runKind), trigger: s.trigger, node: mapSpanNode(s.node), status: s.status, at: s.endedAt ?? s.startedAt }));

  return { nodes, edges, counters, feed, focus, anyRunning: spans.some((s) => s.status === "running" && now - Date.parse(s.startedAt) < 5 * 60_000) || nodes.some((n) => n.status === "active") };
}

// ---------- Event cursor ----------
/** Merge polled spans by id (later versions win, e.g. running → ok), keep the newest `cap`. */
export function mergeSpans(prev: FlowSpan[], incoming: FlowSpan[], cap = 200): FlowSpan[] {
  const byId = new Map(prev.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(-cap);
}

/** Cursor = latest start/end timestamp seen; never moves backwards. */
export function nextCursor(prev: string | null, incoming: Pick<FlowSpan, "startedAt" | "endedAt">[]): string | null {
  let c = prev;
  for (const s of incoming) for (const v of [s.startedAt, s.endedAt]) if (v && (!c || v > c)) c = v;
  return c;
}

// ---------- Translucency & contrast ----------
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

const MUTED: [number, number, number] = [0x52, 0x52, 0x5b];

/**
 * Translucent panel backing that keeps text WCAG AA (4.5:1) over ANY backdrop.
 * Worst case is a black page behind the panel: white at alpha `a` over black
 * yields gray(255·a). We find the minimum alpha where muted text still passes
 * and raise the text backing to it. Without backdrop-filter support the panel
 * falls back to solid white.
 */
export function panelBacking(opacity: number, supportsBlur: boolean): { panelAlpha: number; textAlpha: number; solid: boolean } {
  const o = Math.min(1, Math.max(0.4, opacity));
  if (!supportsBlur) return { panelAlpha: 1, textAlpha: 1, solid: true };
  let min = 1;
  for (let a = 0.4; a <= 1.0001; a += 0.01) {
    const v = Math.round(255 * a);
    if (contrast(MUTED, [v, v, v]) >= 4.5) {
      min = Number(a.toFixed(2));
      break;
    }
  }
  return { panelAlpha: o, textAlpha: Math.max(o, min), solid: false };
}
