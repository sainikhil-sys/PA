import type { Actor, TaskStatus } from "@/lib/db/schema";

/**
 * Task state machine. The owner (me) can move cards freely on the board.
 * Claude / the agent are restricted: they can claim to-do work and submit it
 * for review, but can never mark anything Done. Only the owner approves.
 */
export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  needs_review: "Needs review",
  done: "Done",
};

export const STATUSES: TaskStatus[] = ["todo", "in_progress", "needs_review", "done"];

export const ACTOR_LABEL: Record<Actor, string> = {
  me: "Me",
  agent: "Built-in agent",
  claude: "Claude",
  system: "System",
};

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function canClaim(task: { status: TaskStatus; assignee: Actor }, by: Actor): TransitionCheck {
  if (by === "me") return { ok: true };
  if (task.status === "in_progress" && task.assignee === by) return { ok: true }; // idempotent re-claim
  if (task.status !== "todo") {
    return { ok: false, reason: `Task is in "${STATUS_LABEL[task.status]}". Only "To do" tasks can be claimed.` };
  }
  if (task.assignee !== "me" && task.assignee !== by) {
    return { ok: false, reason: `Task is assigned to ${ACTOR_LABEL[task.assignee]}.` };
  }
  return { ok: true };
}

export function canComplete(task: { status: TaskStatus; assignee: Actor }, by: Actor): TransitionCheck {
  if (by === "me") return { ok: true };
  if (task.status !== "in_progress" || task.assignee !== by) {
    return { ok: false, reason: "Claim the task first (claim_task) before completing it." };
  }
  return { ok: true };
}

export function canMove(from: TaskStatus, to: TaskStatus, by: Actor): TransitionCheck {
  if (from === to) return { ok: true };
  if (by === "me") return { ok: true };
  if (to === "done") return { ok: false, reason: "Only the owner can mark tasks Done." };
  const allowed: Partial<Record<TaskStatus, TaskStatus[]>> = { todo: ["in_progress"], in_progress: ["needs_review"] };
  return allowed[from]?.includes(to)
    ? { ok: true }
    : { ok: false, reason: `Cannot move from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}.` };
}
