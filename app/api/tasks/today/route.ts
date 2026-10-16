import { apiGuard } from "@/lib/auth/api";
import { needsReview, topPriorities } from "@/lib/db/queries/tasks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const [priorities, review] = await Promise.all([topPriorities(g.user.id, 5), needsReview(g.user.id, 3)]);
  const ser = (t: (typeof priorities)[number]) => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate, assignee: t.assignee, status: t.status });
  return Response.json({ priorities: priorities.map(ser), review: review.map(ser) }, { headers: { "cache-control": "no-store" } });
}
