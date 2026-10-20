import { apiGuard } from "@/lib/auth/api";
import { focusMinutesForTask } from "@/lib/db/queries/focus";
import { getTask, listSubtasks, listTasks } from "@/lib/db/queries/tasks";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/** GET all tasks (board/list, polled by SWR) or ?id= for one task with comments and subtasks. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson(400, "invalid id");
    const t = await getTask(g.user.id, id);
    if (!t) return errorJson(404, "not found");
    const [subtasks, focusMinutes] = await Promise.all([listSubtasks(g.user.id, id), focusMinutesForTask(g.user.id, id)]);
    return Response.json({ ...t, subtasks, focusMinutes }, { headers: { "cache-control": "no-store" } });
  }
  return Response.json({ items: await listTasks(g.user.id, { limit: 500 }) }, { headers: { "cache-control": "no-store" } });
}
