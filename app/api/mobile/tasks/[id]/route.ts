import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { emitTaskStatusChange } from "@/lib/automations/events";
import { logActivity } from "@/lib/db/queries/activity";
import { deleteTask, getTask, setTaskDone, TaskError, updateTask } from "@/lib/db/queries/tasks";
import { fail, noStore, readJson } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

async function idFrom(params: Promise<{ id: string }>) {
  const { id } = await params;
  return z.string().uuid().safeParse(id).success ? id : null;
}

/** One task with its description and subtasks. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const id = await idFrom(params);
  if (!id) return fail(404, "Not found");
  const t = await getTask(g.user.id, id);
  if (!t) return fail(404, "That task no longer exists.");
  return Response.json(
    {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      scheduledAt: t.scheduledAt,
      durationMinutes: t.durationMinutes,
      remindAt: t.remindAt,
      assignee: t.assignee,
      recurring: Boolean(t.recurrence),
      completedAt: t.completedAt,
      resultMarkdown: t.resultMarkdown,
    },
    { headers: noStore },
  );
}

const patch = z.object({
  done: z.boolean().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Moving the time moves the reminder with it. */
  scheduledAt: z.string().datetime().nullable().optional(),
  durationMinutes: z.number().int().min(5).max(600).nullable().optional(),
  priority: z.number().int().min(0).max(3).optional(),
});

/** Edit a task, or tick it done / back to to-do. Recurring tasks spawn their next occurrence. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const id = await idFrom(params);
  if (!id) return fail(404, "Not found");
  const parsed = patch.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request");
  const { done, scheduledAt, ...rest } = parsed.data;
  try {
    if (Object.keys(rest).length || scheduledAt !== undefined) {
      await updateTask(g.user.id, id, { ...rest, ...(scheduledAt !== undefined ? { scheduledAt: scheduledAt ? new Date(scheduledAt) : null } : {}) });
    }
    if (done !== undefined) {
      await setTaskDone(g.user.id, id, done);
      await emitTaskStatusChange(g.user.id, id, done ? "done" : "todo");
    }
  } catch (err) {
    if (err instanceof TaskError) return fail(400, err.message);
    throw err;
  }
  return Response.json({ ok: true }, { headers: noStore });
}

/** Cancel (delete) a task. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const id = await idFrom(params);
  if (!id) return fail(404, "Not found");
  await deleteTask(g.user.id, id);
  await logActivity({ userId: g.user.id, actor: "me", tool: "task.deleted", inputSummary: "Android app", outcome: "success" });
  return Response.json({ ok: true }, { headers: noStore });
}
