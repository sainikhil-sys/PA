import { apiGuard } from "@/lib/auth/api";
import { listActivity } from "@/lib/db/queries/activity";

export const dynamic = "force-dynamic";

/** Activity feed (polled every few seconds). ?actor=claude for Claude-only. Content-free summaries only. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const actor = new URL(req.url).searchParams.get("actor");
  const items = await listActivity(g.user.id, { limit: 30, actor: actor === "claude" || actor === "agent" || actor === "me" ? actor : undefined });
  return Response.json({ items }, { headers: { "cache-control": "no-store" } });
}
