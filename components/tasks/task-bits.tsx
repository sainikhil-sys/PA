import { ArrowsClockwise, Robot, Sparkle, User } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import type { Actor } from "@/lib/db/schema";

export type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "needs_review" | "done";
  priority: number;
  tags: string[];
  assignee: Actor;
  createdBy: Actor;
  dueDate: string | null;
  scheduledAt: string | null;
  recurrence: unknown;
  parentId: string | null;
  resultMarkdown: string | null;
  position: number;
};

const ASSIGNEE: Record<Actor, { label: string; Icon: typeof User; variant: "solid" | "outline" | "soft" }> = {
  me: { label: "Me", Icon: User, variant: "soft" },
  agent: { label: "Agent", Icon: Robot, variant: "outline" },
  claude: { label: "Claude", Icon: Sparkle, variant: "solid" },
  system: { label: "System", Icon: Robot, variant: "soft" },
};

/** Assignee is shown by icon + fill style + label, never color. */
export function AssigneeBadge({ assignee, status }: { assignee: Actor; status?: string }) {
  const a = ASSIGNEE[assignee];
  const label = assignee === "claude" && status === "in_progress" ? "In progress by Claude" : a.label;
  return (
    <Badge variant={a.variant}>
      <a.Icon weight={a.variant === "solid" ? "fill" : "regular"} aria-hidden />
      {label}
    </Badge>
  );
}

export const PRIORITY_LABEL = ["None", "Low", "Medium", "High"];

export function PriorityMark({ priority }: { priority: number }) {
  if (!priority) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted" aria-label={`Priority ${PRIORITY_LABEL[priority]}`}>
      <span className="inline-flex gap-[2px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-2.5 w-[3px] rounded-full ${i <= priority ? "bg-foreground" : "bg-border-strong"}`} />
        ))}
      </span>
      {priority === 3 ? "High" : null}
    </span>
  );
}

export function RecurringMark() {
  return (
    <span className="inline-flex items-center text-subtle" aria-label="Recurring">
      <ArrowsClockwise size={14} />
    </span>
  );
}
