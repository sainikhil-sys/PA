import { getConversation, listConversations } from "@/lib/agent/chat";
import { apiGuard } from "@/lib/auth/api";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/** GET ?q= for search, or ?id= for one conversation with messages and proposals. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson(400, "invalid id");
    const c = await getConversation(g.user.id, id);
    return c ? Response.json(c) : errorJson(404, "not found");
  }
  const q = url.searchParams.get("q")?.slice(0, 100) ?? undefined;
  return Response.json({ items: await listConversations(g.user.id, q) }, { headers: { "cache-control": "no-store" } });
}
