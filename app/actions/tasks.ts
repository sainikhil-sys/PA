"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOwner } from "@/lib/auth/session";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { logActivity } from "@/lib/db/queries/activity";
import { getSettings } from "@/lib/db/queries/settings";
import {
  addComment,
  approveTask,
  createTask,
  deleteTask,
  moveTask,
  requestChanges,
  setTaskDone,
  TaskError,
  updateTask,
} from "@/lib/db/queries/tasks";
import { emitTaskStatusChange } from "@/lib/automations/events";
import { describeRecurrence, parseQuickAdd } from "@/lib/tasks/quick-add";
import { formatDateTime } from "@/lib/time";

const uuid = z.string().uuid();
const status = z.enum(["todo", "in_progress", "needs_review", "done"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function wrap(err: unknown): never {
  if (err instanceof TaskError) throw new UserFacingError(err.message);
  throw err;
}

function refresh() {
  revalidatePath("/tasks");
  revalidatePath("/");
}

/** Natural-language quick add used by the command palette, Today and Tasks. */
export async function quickAddTask(text: string): Promise<{ ok: true; summary: string; id: string } | { ok: false; error: string }> {
  const user = await getOwner();
  if (!user) return { ok: false, error: "Please sign in again." };
  const parsed = z.string().trim().min(1, "Type a task").max(300).safeParse(text);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const { timezone } = await getSettings(user.id);
  const q = parseQuickAdd(parsed.data, timezone);
  const task = await createTask(user.id, { ...q, createdBy: "me" });
  await logActivity({ userId: user.id, actor: "me", tool: "task.created", inputSummary: "quick add", outcome: "success" });
  refresh();
  const when = q.recurrence ? describeRecurrence(q.recurrence) : q.scheduledAt ? formatDateTime(q.scheduledAt, timezone) : q.dueDate ? `Due ${q.dueDate}` : null;
  return { ok: true, id: task.id, summary: [q.title, when].filter(Boolean).join(" · ") };
}

export const createTaskAction = ownerAction(
  z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).optional(),
    dueDate: isoDate.nullable().optional(),
    priority: z.number().int().min(0).max(3).optional(),
    tags: z.array(z.string().max(30)).max(10).optional(),
    assignee: z.enum(["me", "agent", "claude"]).optional(),
    parentId: uuid.optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
  }),
  async (input, user) => {
    const task = await createTask(user.id, { ...input, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null, createdBy: "me" });
    refresh();
    return { id: task.id };
  },
);

export const updateTaskAction = ownerAction(
  z.object({
    id: uuid,
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(10_000).optional(),
    dueDate: isoDate.nullable().optional(),
    priority: z.number().int().min(0).max(3).optional(),
    tags: z.array(z.string().max(30)).max(10).optional(),
    assignee: z.enum(["me", "agent", "claude"]).optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
    durationMinutes: z.number().int().min(5).max(600).nullable().optional(),
  }),
  async ({ id, scheduledAt, ...rest }, user) => {
    await updateTask(user.id, id, { ...rest, ...(scheduledAt !== undefined ? { scheduledAt: scheduledAt ? new Date(scheduledAt) : null } : {}) }).catch(wrap);
    refresh();
  },
);

export const moveTaskAction = ownerAction(z.object({ id: uuid, status, position: z.number().optional() }), async (input, user) => {
  const before = await moveTask(user.id, input.id, input.status, input.position).catch(wrap);
  await emitTaskStatusChange(user.id, before.id, input.status);
  refresh();
});

export const toggleTaskDone = ownerAction(z.object({ id: uuid, done: z.boolean() }), async (input, user) => {
  await setTaskDone(user.id, input.id, input.done).catch(wrap);
  await emitTaskStatusChange(user.id, input.id, input.done ? "done" : "todo");
  refresh();
});

export const approveTaskAction = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  await approveTask(user.id, id).catch(wrap);
  await logActivity({ userId: user.id, actor: "me", tool: "task.approved", inputSummary: `id=${id}`, outcome: "success" });
  await emitTaskStatusChange(user.id, id, "done");
  refresh();
});

export const requestChangesAction = ownerAction(z.object({ id: uuid, comment: z.string().trim().min(1, "Add a short note").max(5000) }), async ({ id, comment }, user) => {
  await requestChanges(user.id, id, comment).catch(wrap);
  await logActivity({ userId: user.id, actor: "me", tool: "task.changes_requested", inputSummary: `id=${id}`, outcome: "success" });
  refresh();
});

export const commentTaskAction = ownerAction(z.object({ id: uuid, body: z.string().trim().min(1).max(5000) }), async ({ id, body }, user) => {
  await addComment(user.id, id, "me", body).catch(wrap);
  refresh();
});

/** Destructive, owner-only, always behind a confirm dialog in the UI. */
export const deleteTaskAction = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  await deleteTask(user.id, id);
  await logActivity({ userId: user.id, actor: "me", tool: "task.deleted", inputSummary: `id=${id}`, outcome: "success" });
  refresh();
});
