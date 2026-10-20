import { apiGuard } from "@/lib/auth/api";
import { markAllRead } from "@/lib/db/queries/notifications";
import { noStore } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/** Mark every notification read (the list itself is GET /api/notifications, shared with the web). */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  await markAllRead(g.user.id);
  return Response.json({ ok: true }, { headers: noStore });
}
