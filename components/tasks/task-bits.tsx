import { ArrowsClockwise, Bell, Hourglass, Robot, Sparkle, User } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import type { Actor } from "@/lib/db/schema";
import { formatMinutes, reminderOffsetLabel } from "@/lib/tasks/timing";

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
  durationMinutes: number | null;
  remindAt: string | null;
  reminderSentAt: string | null;
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

export function DurationMark({ minutes }: { minutes: number | null }) {
  if (!minutes) return null;
  return (
    <span className="tabular inline-flex items-center gap-1 text-[11px] text-muted" aria-label={`Takes ${formatMinutes(minutes)}`}>
      <Hourglass size={12} aria-hidden />
      {formatMinutes(minutes)}
    </span>
  );
}

/** Upcoming reminder only (icon + label, never color alone). */
export function ReminderMark({ remindAt, scheduledAt, reminderSentAt }: { remindAt: string | null; scheduledAt: string | null; reminderSentAt: string | null }) {
  if (!remindAt || reminderSentAt || new Date(remindAt).getTime() < Date.now()) return null;
  const label = reminderOffsetLabel(remindAt, scheduledAt) ?? new Date(remindAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <span className="tabular inline-flex items-center gap-1 text-[11px] text-muted" aria-label={`Reminder ${label}`}>
      <Bell size={12} aria-hidden />
      {label}
    </span>
  );
}
