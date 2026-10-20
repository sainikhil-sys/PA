"use client";

import {
  ArrowSquareOut,
  CaretDown,
  CaretUp,
  Crosshair,
  CursorClick,
  Drop,
  Graph,
  ListBullets,
  Minus,
  Pause,
  PushPin,
  PushPinSlash,
  Play,
  SidebarSimple,
  SquareHalfBottom,
  Browsers,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { toggleFlowNode } from "@/app/actions/flow";
import { Sheet } from "@/components/ui/dialog";
import { Skeleton, Switch, Tooltip } from "@/components/ui/misc";
import { isDemoRun, makeDemoRun } from "@/lib/flow/demo";
import { buildPanelState, mergeSpans, NODE_BY_ID, panelBacking, type FlowSpan, type NodeId, type NodeStatus, type PanelState } from "@/lib/flow/model";
import { cn, timeAgo } from "@/lib/utils";
import { useLinkPanel } from "./link-panel-context";
import { StatusMark } from "./node-status";
import { useFlowFeed } from "./use-flow-feed";

const FlowMap = dynamic(() => import("./flow-graph").then((m) => m.FlowMap), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });
const FlowList = dynamic(() => import("./flow-graph").then((m) => m.FlowList), { ssr: false });

const TOGGLEABLE = new Set(["gmail", "tasks", "knowledge", "output:draft", "input:automation", "drive", "notion", "slack", "github"]);
type Filter = "active" | "idle" | "off" | "issues" | null;
const FILTER_MATCH: Record<Exclude<Filter, null>, NodeStatus[]> = { active: ["active", "dry_run"], idle: ["idle"], off: ["off", "not_connected"], issues: ["error", "waiting"] };

function useMediaQuery(q: string) {
  const [m, setM] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/**
 * Live Link panel: a see-through overlay showing how inputs, the agent, models,
 * sources, the approval gate and outputs are linked — and what's moving now.
 * Reads the same trace spans as the Flow page.
 */
export function LinkPanel() {
  const { open, prefs, setPrefs, closePanel, pinnedRunId, pinRun, draft, setDraft } = useLinkPanel();
  const reduce = useReducedMotionConfig();
  const mobile = useMediaQuery("(max-width: 767px)");
  const [demo, setDemo] = React.useState<FlowSpan[] | null>(null);
  const [fast, setFast] = React.useState(false);
  const { spans, base, error } = useFlowFeed({ open, active: fast || Boolean(demo) });
  const [now, setNow] = React.useState(() => Date.now());
  const [filter, setFilter] = React.useState<Filter>(null);
  const [hover, setHover] = React.useState<NodeId | null>(null);
  const [selected, setSelected] = React.useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [feedOpen, setFeedOpen] = React.useState(false);
  const [feedFilter, setFeedFilter] = React.useState<{ node: string; trigger: string }>({ node: "", trigger: "" });
  const [replayStep, setReplayStep] = React.useState<number | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const animate = !prefs.paused && !reduce;
  const [supportsBlur, setSupportsBlur] = React.useState(true);

  React.useEffect(() => setSupportsBlur(typeof CSS !== "undefined" && (CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)"))), []);
  React.useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);
  React.useEffect(() => {
    if (demo && now - Date.parse(demo.at(-1)!.endedAt!) > 30_000) setDemo(null);
  }, [now, demo]);

  const all = React.useMemo(() => (demo ? mergeSpans(spans, demo) : spans), [spans, demo]);
  const latestRun = React.useMemo(() => {
    const last = [...all].reverse().find((s) => s.runKind !== "job");
    return last && now - Date.parse(last.endedAt ?? last.startedAt) < 120_000 ? last.runId : null;
  }, [all, now]);
  const focusRunId = pinnedRunId ?? (prefs.followLatest ? latestRun : null);

  const state: PanelState = React.useMemo(
    () => buildPanelState({ base: base ?? {}, spans: all, now, windowMs: prefs.activeWindowSec * 1000, focusRunId, draft }),
    [base, all, now, prefs.activeWindowSec, focusRunId, draft],
  );
  React.useEffect(() => setFast(state.anyRunning), [state.anyRunning]);

  // Docked modes push page content; floating overlays it.
  React.useEffect(() => {
    const root = document.documentElement;
    const right = open && !mobile && prefs.mode === "right" ? `${prefs.dockWidth}px` : "0px";
    const bottom = open && !mobile && prefs.mode === "bottom" ? "240px" : "0px";
    root.style.setProperty("--lp-right", right);
    root.style.setProperty("--lp-bottom", bottom);
    return () => {
      root.style.setProperty("--lp-right", "0px");
      root.style.setProperty("--lp-bottom", "0px");
    };
  }, [open, mobile, prefs.mode, prefs.dockWidth]);

  // Esc closes (unless another modal dialog is open).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (modal && !rootRef.current?.contains(modal)) return;
      if (selected) setSelected(null);
      else closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selected, closePanel]);

  // Replay the focused run step by step (GSAP timeline, loaded on demand).
  const replay = async () => {
    const steps = state.focus?.steps ?? [];
    if (!steps.length) return;
    if (!animate) {
      setReplayStep(steps.length);
      return;
    }
    const { gsap } = await import("gsap");
    const counter = { i: 0 };
    setReplayStep(0);
    gsap.to(counter, { i: steps.length, duration: Math.min(6, steps.length * 0.6), ease: "none", onUpdate: () => setReplayStep(Math.floor(counter.i)), onComplete: () => setTimeout(() => setReplayStep(null), 800) });
  };

  const focusIds = React.useMemo(() => {
    if (filter) return new Set(state.nodes.filter((n) => FILTER_MATCH[filter].includes(n.status)).map((n) => n.id));
    if (!state.focus) return null;
    const steps = replayStep === null ? state.focus.steps : state.focus.steps.slice(0, Math.max(1, replayStep));
    return new Set(steps.map((s) => s.node));
  }, [filter, state, replayStep]);

  const backing = panelBacking(prefs.opacity, supportsBlur);
  const styleVars = { "--lp-alpha": backing.panelAlpha, "--lp-text-alpha": backing.textAlpha } as React.CSSProperties;

  if (!open) return null;

  // ---------- Minimized pill ----------
  if (prefs.mode === "minimized" && !mobile) {
    return (
      <motion.button
        type="button"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={() => setPrefs({ mode: "floating" })}
        className="lp-surface fixed bottom-24 right-4 z-[55] inline-flex h-11 items-center gap-2 rounded-[12px] px-4 text-[13px] lg:bottom-6"
        style={styleVars}
        aria-label={`Live links: ${state.counters.active} active. Expand panel`}
      >
        <span className={cn("size-2 rounded-full", state.counters.active ? "bg-success" : "border border-border-strong")} aria-hidden />
        <span className="lp-text tabular px-1">{state.counters.active} active</span>
      </motion.button>
    );
  }

  const body = (
    <PanelBody
      state={state}
      mobile={mobile}
      listView={mobile || prefs.listView}
      animate={animate}
      now={now}
      focusIds={focusIds}
      hover={hover}
      setHover={setHover}
      filter={filter}
      setFilter={setFilter}
      selected={selected}
      setSelected={setSelected}
      feedOpen={feedOpen}
      setFeedOpen={setFeedOpen}
      feedFilter={feedFilter}
      setFeedFilter={setFeedFilter}
      pinnedRunId={pinnedRunId}
      pinRun={pinRun}
      replay={replay}
      demo={Boolean(demo)}
      startDemo={() => {
        setDemo(makeDemoRun(Date.now()));
        pinRun(null);
      }}
      draft={draft}
      clearDraft={() => setDraft(null)}
      error={Boolean(error)}
      loading={!base}
    />
  );

  // ---------- Mobile: bottom sheet, list view, no drag/resize ----------
  if (mobile) {
    return (
      <Sheet open onOpenChange={(o) => !o && closePanel()} title="Live links" side="bottom" bodyClassName="p-0">
        <div className="flex max-h-[70dvh] flex-col">{body}</div>
      </Sheet>
    );
  }

  const floating = prefs.mode === "floating";
  const trap = floating && !prefs.clickThrough;

  return (
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label="Live links panel"
      data-lp-paused={!animate}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      style={{
        ...styleVars,
        ...(floating ? { left: prefs.x, top: prefs.y, width: prefs.w, height: prefs.h } : prefs.mode === "right" ? { width: prefs.dockWidth } : {}),
        pointerEvents: prefs.clickThrough ? "none" : undefined,
      }}
      className={cn(
        "lp-surface fixed z-[55] flex flex-col overflow-hidden",
        floating && "rounded-[16px]",
        prefs.mode === "right" && "bottom-0 right-0 top-16 border-r-0",
        prefs.mode === "bottom" && "bottom-0 left-0 right-0 h-[240px] rounded-t-[16px]",
      )}
      onKeyDown={(e) => {
        if (!trap || e.key !== "Tab" || !rootRef.current) return;
        const f = rootRef.current.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <PanelHeader state={state} filter={filter} setFilter={setFilter} floating={floating} />
      {body}
      {floating ? <ResizeHandle /> : null}
    </motion.div>
  );
}

// ---------- Header (drag handle, counters, controls) ----------
function PanelHeader({ state, filter, setFilter, floating }: { state: PanelState; filter: Filter; setFilter: (f: Filter) => void; floating: boolean }) {
  const { prefs, setPrefs, closePanel } = useLinkPanel();
  const drag = React.useRef<{ dx: number; dy: number } | null>(null);
  const [showOpacity, setShowOpacity] = React.useState(false);

  const btn = "grid size-8 place-items-center rounded-[8px] text-muted hover:bg-surface-hover hover:text-foreground aria-pressed:bg-surface-2 aria-pressed:text-foreground";
  const counters: { key: Exclude<Filter, null>; label: string; n: number }[] = [
    { key: "active", label: "Active", n: state.counters.active },
    { key: "idle", label: "Idle", n: state.counters.idle },
    { key: "off", label: "Off", n: state.counters.off },
    { key: "issues", label: "Issues", n: state.counters.issues },
  ];

  return (
    <div className="border-b border-border/70">
      <div
        className={cn("flex items-center gap-2 px-3 pt-2", floating && "cursor-grab active:cursor-grabbing")}
        onPointerDown={(e) => {
          if (!floating || (e.target as HTMLElement).closest("button,input,a")) return;
          drag.current = { dx: e.clientX - prefs.x, dy: e.clientY - prefs.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const x = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx));
          const y = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - drag.current.dy));
          setPrefs({ x: Math.round(x), y: Math.round(y) });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <Graph size={18} className="shrink-0" />
        <h2 className="lp-text px-1 text-[13px] font-medium">Live links</h2>
        <div className="ml-auto flex items-center gap-0.5" style={{ pointerEvents: "auto" }}>
          <Tooltip content={prefs.followLatest ? "Following latest run" : "Follow latest run"}>
            <button type="button" className={btn} aria-pressed={prefs.followLatest} aria-label="Follow latest run" onClick={() => setPrefs({ followLatest: !prefs.followLatest })}>
              <Crosshair size={16} />
            </button>
          </Tooltip>
          <Tooltip content={prefs.listView ? "Show map" : "List view"}>
            <button type="button" className={btn} aria-pressed={prefs.listView} aria-label="List view" onClick={() => setPrefs({ listView: !prefs.listView })}>
              {prefs.listView ? <Graph size={16} /> : <ListBullets size={16} />}
            </button>
          </Tooltip>
          <Tooltip content={prefs.paused ? "Resume animation" : "Pause animation"}>
            <button type="button" className={btn} aria-pressed={prefs.paused} aria-label="Pause animation" onClick={() => setPrefs({ paused: !prefs.paused })}>
              {prefs.paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
          </Tooltip>
          <div className="relative">
            <Tooltip content="Opacity">
              <button type="button" className={btn} aria-expanded={showOpacity} aria-label="Opacity" onClick={() => setShowOpacity((s) => !s)}>
                <Drop size={16} />
              </button>
            </Tooltip>
            {showOpacity ? (
              <div className="absolute right-0 top-9 z-10 w-48 rounded-[12px] border border-border bg-background p-3 shadow-pop">
                <label htmlFor="lp-opacity" className="mb-2 flex justify-between text-[12px]">
                  Opacity <span className="tabular">{Math.round(prefs.opacity * 100)}%</span>
                </label>
                <input id="lp-opacity" type="range" min={40} max={100} step={5} value={Math.round(prefs.opacity * 100)} onChange={(e) => setPrefs({ opacity: Number(e.target.value) / 100 })} className="w-full accent-[var(--foreground)]" />
                <p className="mt-2 text-[11px] text-muted">Text keeps a readable backing at every level.</p>
              </div>
            ) : null}
          </div>
          <Tooltip content={prefs.clickThrough ? "Make interactive" : "Click-through"}>
            <button type="button" className={btn} aria-pressed={prefs.clickThrough} aria-label="Click-through" onClick={() => setPrefs({ clickThrough: !prefs.clickThrough })}>
              <CursorClick size={16} />
            </button>
          </Tooltip>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <Tooltip content="Floating">
            <button type="button" className={btn} aria-pressed={prefs.mode === "floating"} aria-label="Floating" onClick={() => setPrefs({ mode: "floating" })}>
              <Browsers size={16} />
            </button>
          </Tooltip>
          <Tooltip content="Dock right">
            <button type="button" className={btn} aria-pressed={prefs.mode === "right"} aria-label="Dock right" onClick={() => setPrefs({ mode: "right" })}>
              <SidebarSimple size={16} className="-scale-x-100" />
            </button>
          </Tooltip>
          <Tooltip content="Dock bottom">
            <button type="button" className={btn} aria-pressed={prefs.mode === "bottom"} aria-label="Dock bottom" onClick={() => setPrefs({ mode: "bottom" })}>
              <SquareHalfBottom size={16} />
            </button>
          </Tooltip>
          <Tooltip content="Minimize">
            <button type="button" className={btn} aria-label="Minimize" onClick={() => setPrefs({ mode: "minimized" })}>
              <Minus size={16} />
            </button>
          </Tooltip>
          <Tooltip content="Close (Esc)">
            <button type="button" className={btn} aria-label="Close live links" onClick={closePanel}>
              <X size={16} />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 px-3 py-2" role="group" aria-label="Filter nodes by status">
        {counters.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={filter === c.key}
            onClick={() => setFilter(filter === c.key ? null : c.key)}
            className="lp-text inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-border px-2.5 text-[12px] aria-pressed:border-foreground"
          >
            <span className="tabular font-medium">{c.n}</span> {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResizeHandle() {
  const { prefs, setPrefs } = useLinkPanel();
  const start = React.useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  return (
    <div
      role="separator"
      aria-label="Resize panel"
      tabIndex={0}
      className="absolute bottom-0 right-0 size-4 cursor-se-resize"
      style={{ pointerEvents: "auto", background: "linear-gradient(135deg, transparent 50%, var(--border-strong) 50%)", borderBottomRightRadius: 16 }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 16;
        if (e.key === "ArrowRight") setPrefs({ w: Math.min(1200, prefs.w + step) });
        if (e.key === "ArrowLeft") setPrefs({ w: Math.max(320, prefs.w - step) });
        if (e.key === "ArrowDown") setPrefs({ h: Math.min(1000, prefs.h + step) });
        if (e.key === "ArrowUp") setPrefs({ h: Math.max(260, prefs.h - step) });
      }}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY, w: prefs.w, h: prefs.h };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        setPrefs({ w: Math.round(Math.max(320, Math.min(1200, s.w + e.clientX - s.x))), h: Math.round(Math.max(260, Math.min(1000, s.h + e.clientY - s.y))) });
      }}
      onPointerUp={() => (start.current = null)}
    />
  );
}

// ---------- Body ----------
function PanelBody(p: {
  state: PanelState;
  mobile: boolean;
  listView: boolean;
  animate: boolean;
  now: number;
  focusIds: Set<NodeId> | null;
  hover: NodeId | null;
  setHover: (id: NodeId | null) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  selected: { kind: "node" | "edge"; id: string } | null;
  setSelected: (s: { kind: "node" | "edge"; id: string } | null) => void;
  feedOpen: boolean;
  setFeedOpen: (o: boolean) => void;
  feedFilter: { node: string; trigger: string };
  setFeedFilter: (f: { node: string; trigger: string }) => void;
  pinnedRunId: string | null;
  pinRun: (id: string | null) => void;
  replay: () => void;
  demo: boolean;
  startDemo: () => void;
  draft: { label: string } | null;
  clearDraft: () => void;
  error: boolean;
  loading: boolean;
}) {
  const { state } = p;
  const hovered = p.hover ? state.nodes.find((n) => n.id === p.hover) : null;
  const feed = state.feed.filter((f) => (!p.feedFilter.node || f.node === p.feedFilter.node) && (!p.feedFilter.trigger || f.trigger === p.feedFilter.trigger));
  const triggers = [...new Set(state.feed.map((f) => f.trigger))];
  const nodesInFeed = [...new Set(state.feed.map((f) => f.node).filter(Boolean))] as NodeId[];
  const quiet = !state.feed.length;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {p.demo ? <p className="lp-text mx-3 mt-2 px-2 py-1 text-[11px] font-medium">Demo: example run, not real activity.</p> : null}
      {p.draft ? (
        <p className="lp-text mx-3 mt-2 flex items-center justify-between gap-2 px-2 py-1 text-[11px]">
          <span>Draft preview (dashed): {p.draft.label}. Not saved yet.</span>
          <button type="button" onClick={p.clearDraft} className="underline underline-offset-2">
            Clear
          </button>
        </p>
      ) : null}
      {state.focus ? <FocusBar state={state} pinnedRunId={p.pinnedRunId} pinRun={p.pinRun} replay={p.replay} /> : null}

      <div className="relative min-h-[140px] flex-1">
        {p.loading ? (
          <Skeleton className="m-3 h-[calc(100%-24px)]" />
        ) : p.listView ? (
          <div className="lp-text absolute inset-2 overflow-y-auto p-2" data-lenis-prevent>
            <FlowList nodes={state.nodes} edges={state.edges} onNodeClick={(id) => p.setSelected({ kind: "node", id })} />
          </div>
        ) : (
          <FlowMap nodes={state.nodes} edges={state.edges} variant="compact" highlight={p.hover} focusIds={p.focusIds} animate={p.animate} now={p.now} onNodeHover={p.setHover} onNodeClick={(id) => p.setSelected({ kind: "node", id })} onEdgeClick={(id) => p.setSelected({ kind: "edge", id })} />
        )}
        {hovered && !p.listView ? (
          <div className="lp-text pointer-events-none absolute bottom-2 left-2 max-w-[260px] border border-border px-3 py-2 text-[11px]" role="status">
            <p className="font-medium">{hovered.label}</p>
            <p className="text-muted">Last activity: {hovered.lastActivityAt ? timeAgo(hovered.lastActivityAt) : "none"}</p>
            <p className="text-muted">
              Calls (1h): <span className="tabular">{hovered.calls1h}</span> · Permissions: {hovered.permissions}
            </p>
          </div>
        ) : null}
        <AnimatePresence>{p.selected ? <SelectionDrawer state={state} selected={p.selected} onClose={() => p.setSelected(null)} /> : null}</AnimatePresence>
        {p.error ? <p className="lp-text absolute right-2 top-2 px-2 py-1 text-[11px] text-danger">Live updates paused. Retrying…</p> : null}
      </div>

      {/* Live feed */}
      <div className="border-t border-border/70 px-3 py-2">
        <div className="flex items-center gap-2">
          <p className="lp-text min-w-0 flex-1 truncate px-1 text-[12px]" aria-live="polite">
            <span className="font-medium">Now:</span> {quiet ? "All quiet. Nothing ran in the last 10 minutes." : `${state.feed[0]!.actor} · ${state.feed[0]!.text}`}
          </p>
          {quiet && !p.demo ? (
            <button type="button" onClick={p.startDemo} className="lp-text h-7 shrink-0 rounded-[8px] border border-dashed border-border-strong px-2.5 text-[11px]">
              Example run (demo)
            </button>
          ) : null}
          {!quiet ? (
            <button type="button" onClick={() => p.setFeedOpen(!p.feedOpen)} aria-expanded={p.feedOpen} className="grid size-7 place-items-center rounded-[8px] text-muted hover:bg-surface-hover" aria-label={p.feedOpen ? "Collapse events" : "Show recent events"}>
              {p.feedOpen ? <CaretDown size={14} /> : <CaretUp size={14} />}
            </button>
          ) : null}
        </div>
        {p.feedOpen && !quiet ? (
          <div className="mt-2">
            <div className="mb-2 flex gap-2">
              <select aria-label="Filter by tool" value={p.feedFilter.node} onChange={(e) => p.setFeedFilter({ ...p.feedFilter, node: e.target.value })} className="h-8 rounded-[8px] border border-border bg-background px-2 text-[12px]">
                <option value="">All tools</option>
                {nodesInFeed.map((n) => (
                  <option key={n} value={n}>
                    {NODE_BY_ID.get(n)?.label ?? n}
                  </option>
                ))}
              </select>
              <select aria-label="Filter by trigger" value={p.feedFilter.trigger} onChange={(e) => p.setFeedFilter({ ...p.feedFilter, trigger: e.target.value })} className="h-8 rounded-[8px] border border-border bg-background px-2 text-[12px]">
                <option value="">All triggers</option>
                {triggers.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <ol className="lp-text max-h-40 overflow-y-auto p-1" data-lenis-prevent aria-label="Recent events">
              {feed.map((f) => (
                <li key={f.id} className="flex items-center gap-2 py-1 text-[12px]">
                  <span className={cn("size-1.5 shrink-0 rounded-full", f.status === "error" ? "bg-danger" : f.status === "waiting" ? "bg-warning" : "bg-foreground")} aria-hidden />
                  {isDemoRun(f.runId) ? (
                    <span className="min-w-0 flex-1 truncate">{f.text}</span>
                  ) : (
                    <Link href={`/flow/${f.runId}`} className="min-w-0 flex-1 truncate hover:underline">
                      <span className="text-muted">{f.actor}:</span> {f.text}
                    </Link>
                  )}
                  <span className="tabular shrink-0 text-subtle">{timeAgo(f.at)}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FocusBar({ state, pinnedRunId, pinRun, replay }: { state: PanelState; pinnedRunId: string | null; pinRun: (id: string | null) => void; replay: () => void }) {
  const f = state.focus!;
  const pct = f.total ? Math.round((f.completed / f.total) * 100) : 0;
  const kind = f.runKind === "mcp" ? "Claude" : f.runKind === "voice" ? "Voice" : f.runKind === "automation" ? "Automation" : "Chat";
  return (
    <div className="lp-text mx-3 mt-2 flex items-center gap-2 px-2 py-1.5">
      <span className="text-[12px] font-medium">{kind} run</span>
      <div className="h-1 min-w-12 flex-1 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={f.total} aria-valuenow={f.completed} aria-label="Run progress">
        <div className="h-full origin-left bg-foreground transition-transform duration-200" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      <span className="tabular text-[11px] text-muted">
        {f.completed}/{f.total}
      </span>
      <button type="button" className="grid size-7 place-items-center rounded-[8px] hover:bg-surface-hover" onClick={replay} aria-label="Replay run">
        <Play size={14} />
      </button>
      <button type="button" className="grid size-7 place-items-center rounded-[8px] hover:bg-surface-hover" onClick={() => pinRun(pinnedRunId ? null : f.runId)} aria-pressed={Boolean(pinnedRunId)} aria-label={pinnedRunId ? "Release pinned run" : "Pin this run"}>
        {pinnedRunId ? <PushPinSlash size={14} /> : <PushPin size={14} />}
      </button>
      {!isDemoRun(f.runId) ? (
        <Link href={`/flow/${f.runId}`} className="grid size-7 place-items-center rounded-[8px] hover:bg-surface-hover" aria-label="Open in Flow">
          <ArrowSquareOut size={14} />
        </Link>
      ) : null}
    </div>
  );
}

function SelectionDrawer({ state, selected, onClose }: { state: PanelState; selected: { kind: "node" | "edge"; id: string }; onClose: () => void }) {
  const [pending, start] = React.useTransition();
  const node = selected.kind === "node" ? state.nodes.find((n) => n.id === selected.id) : null;
  const edge = selected.kind === "edge" ? state.edges.find((e) => e.id === selected.id) : null;
  const events = node ? state.feed.filter((f) => f.node === node.id).slice(0, 5) : [];
  const runForNode = events.find((e) => !isDemoRun(e.runId))?.runId;

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-y-2 right-2 z-10 flex w-[240px] flex-col gap-3 overflow-y-auto rounded-[12px] border border-border bg-background p-3 text-[12px] shadow-pop"
      data-lenis-prevent
      role="region"
      aria-label={node ? `${node.label} details` : "Link details"}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium">{node ? node.label : `${NODE_BY_ID.get(edge!.from)?.label} → ${NODE_BY_ID.get(edge!.to)?.label}`}</p>
        <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-[8px] hover:bg-surface-hover" aria-label="Close details">
          <X size={14} />
        </button>
      </div>
      {node ? (
        <>
          <StatusMark status={node.status} />
          <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-muted">Last activity</dt>
              <dd>{node.lastActivityAt ? timeAgo(node.lastActivityAt) : "None"}</dd>
            </div>
            <div>
              <dt className="text-muted">Calls (1h)</dt>
              <dd className="tabular">{node.calls1h}</dd>
            </div>
            <div>
              <dt className="text-muted">Errors (1h)</dt>
              <dd className="tabular">{node.errors1h}</dd>
            </div>
            <div>
              <dt className="text-muted">Access</dt>
              <dd>{node.permissions}</dd>
            </div>
          </dl>
          {TOGGLEABLE.has(node.id) && node.status !== "not_connected" ? (
            <label className="flex items-center justify-between gap-2">
              <span>{node.status === "off" ? "Off" : "On"}</span>
              <Switch
                checked={node.status !== "off"}
                disabled={pending}
                aria-label={`Turn ${node.label} ${node.status === "off" ? "on" : "off"}`}
                onCheckedChange={(v) =>
                  start(async () => {
                    const r = await toggleFlowNode({ node: node.id as "gmail", enabled: v });
                    if (!r.ok) toast.error(r.error);
                    else toast.success(`${node.label} turned ${v ? "on" : "off"}`);
                  })
                }
              />
            </label>
          ) : null}
          <div>
            <p className="mb-1 font-medium">Last events</p>
            {events.length ? (
              <ol className="flex flex-col gap-1">
                {events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="truncate">{e.text}</span>
                    <span className="tabular shrink-0 text-subtle">{timeAgo(e.at)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted">No recent events.</p>
            )}
          </div>
          <div className="mt-auto flex flex-col gap-1">
            {node.settingsHref ? (
              <Link href={node.settingsHref} className="underline underline-offset-2">
                Open settings
              </Link>
            ) : null}
            {runForNode ? (
              <Link href={`/flow/${runForNode}`} className="underline underline-offset-2">
                Open in Flow
              </Link>
            ) : null}
          </div>
        </>
      ) : edge ? (
        <>
          <p className="text-muted">State: {edge.draft ? "draft (not saved)" : edge.state}</p>
          <div>
            <p className="mb-1 font-medium">Recently moved</p>
            {edge.summaries.length ? (
              <ol className="flex flex-col gap-1">
                {edge.summaries
                  .slice()
                  .reverse()
                  .map((s, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">{s.label}</span>
                      <span className="tabular shrink-0 text-subtle">{timeAgo(s.at)}</span>
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="text-muted">Nothing has moved across this link recently.</p>
            )}
          </div>
          <p className="text-[11px] text-subtle">Counts and summaries only, never message or document content.</p>
        </>
      ) : null}
    </motion.div>
  );
}

