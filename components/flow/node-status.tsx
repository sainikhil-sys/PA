import { Warning } from "@phosphor-icons/react";
import { STATUS_LABEL, type NodeStatus } from "@/lib/flow/model";
import { cn } from "@/lib/utils";

/**
 * Status is never color alone: a dot (filled / hollow / half / none) + icon + text label.
 * Color appears only as a tiny semantic dot, per the design rules.
 */
export function StatusMark({ status, compact }: { status: NodeStatus; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", compact ? "text-[10px]" : "text-[11px]", "text-muted")}>
      <Dot status={status} />
      {status === "error" ? <Warning size={compact ? 10 : 12} weight="fill" className="text-danger" aria-hidden /> : null}
      <span>{STATUS_LABEL[status]}</span>
    </span>
  );
}

function Dot({ status }: { status: NodeStatus }) {
  switch (status) {
    case "active":
    case "dry_run":
      return (
        <span className="relative inline-flex size-2" aria-hidden>
          <span className="absolute inset-0 rounded-full bg-success opacity-60 motion-safe:animate-ping [[data-lp-paused=true]_&]:animate-none" />
          <span className="relative size-2 rounded-full bg-success" />
        </span>
      );
    case "waiting":
      // Amber half-filled dot.
      return <span className="inline-block size-2 rounded-full border border-warning bg-[linear-gradient(90deg,var(--warning)_50%,transparent_50%)]" aria-hidden />;
    case "error":
      return <span className="inline-block size-2 rounded-full bg-danger" aria-hidden />;
    case "idle":
      return <span className="inline-block size-2 rounded-full border border-border-strong" aria-hidden />;
    default:
      return null;
  }
}
