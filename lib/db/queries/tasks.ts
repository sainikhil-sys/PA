import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, max, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Actor, Recurrence, TaskArtifact, TaskStatus } from "@/lib/db/schema";
import { getSettings } from "./settings";
import { nextOccurrence } from "@/lib/tasks/quick-add";
import { canClaim, canComplete, canMove } from "@/lib/tasks/transitions";

export class TaskError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "forbidden" | "invalid",
  ) {
    super(message);
  }
}

export async function listTasks(userId: string, opts: { status?: TaskStatus[]; limit?: number } = {}) {
  const conds = [eq(schema.tasks.userId, userId)];
  if (opts.status?.length) conds.push(inArray(schema.tasks.status, opts.status));
  return db()
    .select()
    .from(schema.tasks)
    .where(and(...conds))
    .orderBy(asc(schema.tasks.position), desc(schema.tasks.createdAt))
    .limit(Math.min(opts.limit ?? 200, 500));
}

export async function getTask(userId: string, id: string) {
  const task = await db().query.tasks.findFirst({ where: and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)) });
  if (!task) return null;
  const comments = await db()
    .select()
    .from(schema.taskComments)
    .where(eq(schema.taskComments.taskId, id))
    .orderBy(asc(schema.taskComments.createdAt));
  return { ...task, comments };
}

async function nextPosition(userId: string, status: TaskStatus) {
  const [row] = await db()
    .select({ m: max(schema.tasks.position) })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.status, status)));
  return (row?.m ?? 0) + 1024;
}

export async function createTask(
  userId: string,
  input: {
    title: string;
    description?: string;
    dueDate?: string | null;
    assignee?: Actor;
    createdBy: Actor;
    sourceEmailId?: string | null;
    priority?: number;
    tags?: string[];
    scheduledAt?: Date | null;
    durationMinutes?: number | null;
    recurrence?: Recurrence | null;
    remindAt?: Date | null;
    parentId?: string | null;
  },
) {
  const [task] = await db()
    .insert(schema.tasks)
    .values({
      userId,
      title: input.title,
      description: input.description ?? "",
      dueDate: input.dueDate ?? null,
      assignee: input.assignee ?? (input.createdBy === "claude" ? "claude" : "me"),
      createdBy: input.createdBy,
      sourceEmailId: input.sourceEmailId ?? null,
      priority: input.priority ?? 0,
      tags: input.tags ?? [],
      scheduledAt: input.scheduledAt ?? null,
      durationMinutes: input.durationMinutes ?? null,
      recurrence: input.recurrence ?? null,
      remindAt: input.remindAt ?? input.scheduledAt ?? null,
      parentId: input.parentId ?? null,
      position: await nextPosition(userId, "todo"),
    })
    .returning();
  return task!;
}

export async function updateTask(
  userId: string,
  id: string,
  input: {
    title?: string;
    description?: string;
    dueDate?: string | null;
    assignee?: Actor;
    priority?: number;
    tags?: string[];
    scheduledAt?: Date | null;
    durationMinutes?: number | null;
    recurrence?: Recurrence | null;
  },
) {
  const [task] = await db()
    .update(schema.tasks)
    .set(input)
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
    .returning();
  if (!task) throw new TaskError("Task not found", "not_found");
  return task;
}

async function mustGet(userId: string, id: string) {
  const task = await db().query.tasks.findFirst({ where: and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)) });
  if (!task) throw new TaskError("Task not found", "not_found");
  return task;
}

/** Owner moves a card on the board (drag and drop or keyboard). */
export async function moveTask(userId: string, id: string, to: TaskStatus, position?: number) {
  const task = await mustGet(userId, id);
  const check = canMove(task.status, to, "me");
  if (!check.ok) throw new TaskError(check.reason, "forbidden");
  const [updated] = await db()
    .update(schema.tasks)
    .set({
      status: to,
      position: position ?? (task.status === to ? task.position : await nextPosition(userId, to)),
      completedAt: to === "done" ? new Date() : null,
    })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
    .returning();
  return updated!;
}

export async function claimTask(userId: string, id: string, by: Actor, tokenId?: string | null) {
  const task = await mustGet(userId, id);
  const check = canClaim(task, by);
  if (!check.ok) throw new TaskError(check.reason, "forbidden");
  // Conditional update guards against concurrent claims.
  const [updated] = await db()
    .update(schema.tasks)
    .set({
      status: "in_progress",
      assignee: by,
      claimedAt: new Date(),
      claimedByTokenId: tokenId ?? null,
      position: task.status === "in_progress" ? task.position : await nextPosition(userId, "in_progress"),
    })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId), eq(schema.tasks.status, task.status)))
    .returning();
  if (!updated) throw new TaskError("Task changed while claiming; try again.", "invalid");
  return updated;
}

export async function completeTask(
  userId: string,
  id: string,
  by: Actor,
  result: { markdown: string; artifacts?: TaskArtifact[] },
) {
  const task = await mustGet(userId, id);
  const check = canComplete(task, by);
  if (!check.ok) throw new TaskError(check.reason, "forbidden");
  const position = await nextPosition(userId, "needs_review");
  return db().transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.tasks)
      .set({
        status: "needs_review",
        resultMarkdown: result.markdown,
        artifacts: result.artifacts ?? null,
        resultAt: new Date(),
        position,
      })
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .returning();
    await tx
      .insert(schema.taskComments)
      .values({ userId, taskId: id, author: by, kind: "result", body: "Submitted a result for review." });
    return updated!;
  });
}

/** Owner approves a result: Needs review -> Done. */
export async function approveTask(userId: string, id: string) {
  const task = await mustGet(userId, id);
  if (task.status !== "needs_review") throw new TaskError("Only tasks in Needs review can be approved.", "invalid");
  const position = await nextPosition(userId, "done");
  return db().transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.tasks)
      .set({ status: "done", completedAt: new Date(), position })
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .returning();
    await tx.insert(schema.taskComments).values({ userId, taskId: id, author: "me", kind: "comment", body: "Approved." });
    return updated!;
  });
}

/** Owner requests changes: Needs review -> To do. The comment is visible to Claude via get_task. */
export async function requestChanges(userId: string, id: string, comment: string) {
  const task = await mustGet(userId, id);
  if (task.status !== "needs_review") throw new TaskError("Only tasks in Needs review can be sent back.", "invalid");
  const position = await nextPosition(userId, "todo");
  return db().transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.tasks)
      .set({ status: "todo", completedAt: null, position })
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .returning();
    await tx
      .insert(schema.taskComments)
      .values({ userId, taskId: id, author: "me", kind: "change_request", body: comment });
    return updated!;
  });
}

export async function addComment(userId: string, taskId: string, author: Actor, body: string) {
  await mustGet(userId, taskId);
  const [c] = await db().insert(schema.taskComments).values({ userId, taskId, author, body }).returning();
  return c!;
}

/** Owner-only, from the dashboard behind a confirm dialog. Never exposed to Claude. */
export async function deleteTask(userId: string, id: string) {
  await db().delete(schema.tasks).where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)));
}

export async function taskCounts(userId: string) {
  const rows = await db()
    .select({ status: schema.tasks.status, assignee: schema.tasks.assignee, n: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(eq(schema.tasks.userId, userId))
    .groupBy(schema.tasks.status, schema.tasks.assignee);
  const byStatus: Record<TaskStatus, number> = { todo: 0, in_progress: 0, needs_review: 0, done: 0 };
  let claudeOpen = 0;
  for (const r of rows) {
    byStatus[r.status] += r.n;
    if (r.assignee === "claude" && r.status !== "done") claudeOpen += r.n;
  }
  return { byStatus, claudeOpen };
}

/** Checkbox toggle. Completing a recurring task schedules its next occurrence. */
export async function setTaskDone(userId: string, id: string, done: boolean) {
  const task = await mustGet(userId, id);
  const updated = await moveTask(userId, id, done ? "done" : "todo");
  if (done && task.recurrence && !task.parentId) {
    const { timezone } = await getSettings(userId);
    const next = nextOccurrence(task.recurrence, timezone, task.scheduledAt && task.scheduledAt > new Date() ? task.scheduledAt : new Date());
    await createTask(userId, {
      title: task.title,
      description: task.description,
      createdBy: task.createdBy,
      assignee: task.assignee,
      priority: task.priority,
      tags: task.tags,
      recurrence: task.recurrence,
      scheduledAt: next,
      durationMinutes: task.durationMinutes,
    });
  }
  return updated;
}

/** Tasks scheduled in [from, to) for the calendar views. */
export async function listScheduled(userId: string, from: Date, to: Date) {
  return db()
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, userId), isNotNull(schema.tasks.scheduledAt), gte(schema.tasks.scheduledAt, from), lt(schema.tasks.scheduledAt, to)))
    .orderBy(asc(schema.tasks.scheduledAt));
}

/** Top open priorities for the Today card. */
export async function topPriorities(userId: string, limit = 5) {
  return db()
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, userId), inArray(schema.tasks.status, ["todo", "in_progress"]), isNull(schema.tasks.parentId)))
    .orderBy(desc(schema.tasks.priority), sql`${schema.tasks.dueDate} asc nulls last`, asc(schema.tasks.position))
    .limit(limit);
}

export async function needsReview(userId: string, limit = 5) {
  return db()
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.status, "needs_review")))
    .orderBy(desc(schema.tasks.resultAt))
    .limit(limit);
}

export async function listSubtasks(userId: string, parentId: string) {
  return db()
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, userId), eq(schema.tasks.parentId, parentId)))
    .orderBy(asc(schema.tasks.createdAt));
}

/** Due reminders not yet delivered. */
export async function dueReminders(userId: string, now = new Date()) {
  return db()
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, userId), ne(schema.tasks.status, "done"), isNotNull(schema.tasks.remindAt), lt(schema.tasks.remindAt, now), isNull(schema.tasks.reminderSentAt)))
    .limit(20);
}
