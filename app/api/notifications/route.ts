import { apiGuard } from "@/lib/auth/api";
import { listNotifications } from "@/lib/db/queries/notifications";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  return Response.json(await listNotifications(g.user.id), { headers: { "cache-control": "no-store" } });
}
