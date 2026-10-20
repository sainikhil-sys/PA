import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { logActivity } from "@/lib/db/queries/activity";
import { getSettings } from "@/lib/db/queries/settings";
import { createTask, listTasks } from "@/lib/db/queries/tasks";
import { fail, noStore, readJson } from "@/lib/mobile/http";
import { describeRecurrence, parseQuickAdd } from "@/lib/tasks/quick-add";
import { formatDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Open tasks for the app's Tasks screen. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const rows = await listTasks(g.user.id, { status: ["todo", "in_progress", "needs_review"], limit: 200 });
  return Response.json(
    {
      items: rows
        .filter((t) => !t.parentId)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          scheduledAt: t.scheduledAt,
          assignee: t.assignee,
          recurring: Boolean(t.recurrence),
        })),
    },
    { headers: noStore },
  );
}

/** Natural-language quick add ("call mom tomorrow 6pm #family"), same parser as the web. */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = z.object({ text: z.string().trim().min(1, "Type a task").max(300) }).safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Type a task");
  const { timezone } = await getSettings(g.user.id);
  const q = parseQuickAdd(parsed.data.text, timezone);
  const task = await createTask(g.user.id, { ...q, createdBy: "me" });
  await logActivity({ userId: g.user.id, actor: "me", tool: "task.created", inputSummary: "quick add (Android app)", outcome: "success" });
  const when = q.recurrence ? describeRecurrence(q.recurrence) : q.scheduledAt ? formatDateTime(q.scheduledAt, timezone) : q.dueDate ? `Due ${q.dueDate}` : null;
  return Response.json({ ok: true, id: task.id, summary: [q.title, when].filter(Boolean).join(" · ") }, { headers: noStore });
}
