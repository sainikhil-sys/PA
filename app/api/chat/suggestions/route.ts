import { suggestedPrompts } from "@/lib/agent/suggestions";
import { apiGuard } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  return Response.json({ items: await suggestedPrompts(g.user.id) }, { headers: { "cache-control": "private, max-age=60" } });
}
