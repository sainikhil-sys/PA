import { apiGuard } from "@/lib/auth/api";
import { markAllRead, markRead } from "@/lib/db/queries/notifications";
import { noStore } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/**
 * Mark notifications read: one with {id}, otherwise all of them. The list itself is GET
 * /api/notifications, shared with the web.
 */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (id) await markRead(g.user.id, id);
  else await markAllRead(g.user.id);
  return Response.json({ ok: true }, { headers: noStore });
}
