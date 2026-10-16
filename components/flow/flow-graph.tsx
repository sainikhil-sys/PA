"use client";

import "@xyflow/react/dist/style.css";
import { Lock } from "@phosphor-icons/react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import Link from "next/link";
import * as React from "react";
import { BrandLogo } from "@/components/integrations/brand-logo";
import { displayColumn, RECENT_MS, type EdgeState, type NodeId, type PanelEdge, type PanelNode } from "@/lib/flow/model";
import { cn, timeAgo } from "@/lib/utils";
import { FLOW_ICON } from "./flow-icons";
import { StatusMark } from "./node-status";

export type FlowVariant = "compact" | "full";

type NodeData = { node: PanelNode; variant: FlowVariant; dimmed: boolean; highlighted: boolean; animate: boolean };
type EdgeData = { edge: PanelEdge; variant: FlowVariant; dimmed: boolean; animate: boolean; now: number };

// ---------- Node ----------
function FlowNodeView({ data }: NodeProps<Node<NodeData>>) {
  const { node, variant, dimmed, highlighted } = data;
  const compact = variant === "compact";
  const Icon = node.icon ? FLOW_ICON[node.icon] : undefined;
  const off = node.status === "off";
  return (
    <div
      className={cn(
        "relative flex items-center gap-2 rounded-[10px] border bg-background transition-opacity duration-200",
        compact ? "w-[132px] px-2 py-1.5" : "w-[188px] px-3 py-2.5",
        node.status === "not_connected" || node.status === "dry_run" ? "border-dashed border-border-strong" : highlighted ? "border-foreground" : "border-border",
        dimmed && "opacity-30",
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
      <span className={cn("grid shrink-0 place-items-center", off && "opacity-40 grayscale")}>
        {node.logo ? <BrandLogo id={node.logo} size={compact ? 16 : 20} /> : Icon ? <Icon size={compact ? 16 : 20} className="text-foreground" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-medium leading-tight", compact ? "text-[11px]" : "text-[13px]")}>{node.label}</span>
        {node.status === "not_connected" && node.settingsHref ? (
          <Link href={node.settingsHref} className={cn("underline underline-offset-2", compact ? "text-[10px]" : "text-[11px]")} onClick={(e) => e.stopPropagation()}>
            Connect
          </Link>
        ) : (
          <StatusMark status={node.status} compact={compact} />
        )}
      </span>
      {node.step ? (
        <span className="tabular absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground" aria-label={`Step ${node.step}`}>
          {node.step}
        </span>
      ) : null}
      <Handle type="source" position={Position.Right} className="!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
    </div>
  );
}

// ---------- Edge ----------
const STROKE: Record<EdgeState, { stroke: string; width: number; dash?: string }> = {
  idle: { stroke: "var(--border-strong)", width: 1 },
  active: { stroke: "var(--foreground)", width: 1.6 },
  recent: { stroke: "var(--muted)", width: 1.2 },
  disabled: { stroke: "var(--border)", width: 1, dash: "4 4" },
  error: { stroke: "var(--danger)", width: 1.4, dash: "5 4" },
  blocked: { stroke: "var(--border-strong)", width: 1, dash: "2 3" },
};

function FlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<EdgeData>>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const e = data!.edge;
  const s = STROKE[e.state];
  // Recently used lines fade out over 60s.
  const fade = e.state === "recent" && e.lastUsedAt ? Math.max(0.35, 1 - (data!.now - e.lastUsedAt) / RECENT_MS) : 1;
  const opacity = (data!.dimmed ? 0.15 : 1) * fade;
  return (
    <>
      <g className={cn(e.state === "error" && data!.animate && "lp-shake-once")} style={{ opacity }}>
        <BaseEdge id={id} path={path} style={{ stroke: e.draft ? "var(--foreground)" : s.stroke, strokeWidth: s.width, strokeDasharray: e.draft ? "6 4" : s.dash, opacity: e.draft ? 0.6 : 1 }} />
        {e.state === "active" && data!.animate
          ? [0, 1, 2].map((i) => (
              <circle key={i} r={2.2} fill="var(--foreground)">
                {/* Travelling dots in the direction of data flow (transform-only animation). */}
                <animateMotion dur="1.6s" repeatCount="indefinite" begin={`${i * 0.53}s`} path={path} />
              </circle>
            ))
          : null}
      </g>
      {e.state === "blocked" ? (
        <EdgeLabelRenderer>
          <span className="pointer-events-none absolute grid size-4 place-items-center rounded-full border border-border bg-background" style={{ transform: `translate(-50%,-50%) translate(${targetX - 10}px,${targetY}px)` }} aria-label="Blocked by permission">
            <Lock size={10} weight="bold" />
          </span>
        </EdgeLabelRenderer>
      ) : null}
      <EdgeLabelRenderer>
        <span className="sr-only" style={{ position: "absolute", transform: `translate(${labelX}px,${labelY}px)` }}>
          {e.from} to {e.to}: {e.state}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { pa: FlowNodeView };
const edgeTypes = { pa: FlowEdgeView };

/**
 * Lane layout: Inputs → Agent core → Models → Tools & sources → Approval gate → Outputs.
 * Only transform/opacity animate; React Flow virtualises off-screen nodes.
 */
export function FlowMap({
  nodes,
  edges,
  variant,
  highlight,
  focusIds,
  animate,
  now,
  onNodeClick,
  onEdgeClick,
  onNodeHover,
  className,
}: {
  nodes: PanelNode[];
  edges: PanelEdge[];
  variant: FlowVariant;
  highlight?: NodeId | null;
  focusIds?: Set<NodeId> | null;
  animate: boolean;
  now: number;
  onNodeClick?: (id: NodeId) => void;
  onEdgeClick?: (id: string) => void;
  onNodeHover?: (id: NodeId | null) => void;
  className?: string;
}) {
  const colW = variant === "compact" ? 170 : 240;
  const rowH = variant === "compact" ? 54 : 74;

  const related = React.useMemo(() => {
    if (!highlight) return null;
    const set = new Set<NodeId>([highlight]);
    for (const e of edges) if (e.from === highlight || e.to === highlight) set.add(e.from === highlight ? e.to : e.from);
    return set;
  }, [highlight, edges]);

  const rfNodes = React.useMemo<Node<NodeData>[]>(() => {
    const rows = new Map<number, number>();
    return nodes.map((n) => {
      const col = displayColumn(n);
      const row = rows.get(col) ?? 0;
      rows.set(col, row + 1);
      const offset = col === 2 && ["drive", "notion", "slack", "github"].includes(n.id) ? 0.6 : 0; // small gap between models and sources
      const dimmed = Boolean((related && !related.has(n.id)) || (focusIds && !focusIds.has(n.id)));
      return {
        id: n.id,
        type: "pa",
        position: { x: col * colW, y: (row + offset) * rowH },
        data: { node: n, variant, dimmed, highlighted: Boolean(related?.has(n.id) || focusIds?.has(n.id)), animate },
        draggable: false,
        selectable: true,
        focusable: true,
        ariaLabel: `${n.label}: ${n.status.replace("_", " ")}`,
      };
    });
  }, [nodes, related, focusIds, variant, animate, colW, rowH]);

  const rfEdges = React.useMemo<Edge<EdgeData>[]>(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        type: "pa",
        focusable: true,
        data: { edge: e, variant, dimmed: Boolean((related && !(related.has(e.from) && related.has(e.to) && (e.from === highlight || e.to === highlight))) || (focusIds && !(focusIds.has(e.from) && focusIds.has(e.to)))), animate, now },
      })),
    [edges, related, highlight, focusIds, variant, animate, now],
  );

  return (
    <div className={cn("h-full w-full", className)} data-lenis-prevent>
      <ReactFlowProvider>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.3}
          maxZoom={1.6}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => onNodeClick?.(n.id)}
          onEdgeClick={(_, e) => onEdgeClick?.(e.id)}
          onNodeMouseEnter={(_, n) => onNodeHover?.(n.id)}
          onNodeMouseLeave={() => onNodeHover?.(null)}
          className="!bg-transparent"
        />
      </ReactFlowProvider>
    </div>
  );
}

/** Keyboard/screen-reader alternative: ordered list of nodes with status and links. */
export function FlowList({ nodes, edges, onNodeClick }: { nodes: PanelNode[]; edges: PanelEdge[]; onNodeClick?: (id: NodeId) => void }) {
  const lanes = ["Inputs", "Agent core", "Models & sources", "Tools & sources", "Approval gate", "Outputs"];
  return (
    <ol className="flex flex-col gap-4" aria-label="Nodes and links">
      {lanes.map((lane, i) => {
        const ns = nodes.filter((n) => displayColumn(n) === i);
        if (!ns.length) return null;
        return (
          <li key={lane}>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{lane}</p>
            <ul className="flex flex-col">
              {ns.map((n) => {
                const out = edges.filter((e) => e.from === n.id);
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => onNodeClick?.(n.id)} className="flex w-full min-h-11 items-center gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-surface-hover">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[13px]">
                          {n.step ? <span className="tabular grid size-4 place-items-center rounded-full bg-primary text-[9px] text-primary-foreground">{n.step}</span> : null}
                          {n.label}
                        </span>
                        {out.length ? <span className="block truncate text-[11px] text-subtle">→ {out.map((e) => `${nodes.find((x) => x.id === e.to)?.label} (${e.state})`).join(", ")}</span> : null}
                      </span>
                      <StatusMark status={n.status} />
                      {n.lastActivityAt ? <span className="tabular text-[11px] text-subtle">{timeAgo(n.lastActivityAt)}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
