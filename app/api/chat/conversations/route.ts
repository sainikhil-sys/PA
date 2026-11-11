import { z } from "zod";
import { deleteConversation, getConversation, listConversations, renameConversation } from "@/lib/agent/chat";
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

const UUID = /^[0-9a-f-]{36}$/i;
const renameSchema = z.object({ title: z.string().trim().min(1).max(120) });

/** PATCH ?id= with {title}: rename a chat. */
export async function PATCH(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !UUID.test(id)) return errorJson(400, "invalid id");
  const parsed = renameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson(400, "invalid_request");
  return (await renameConversation(g.user.id, id, parsed.data.title)) ? Response.json({ ok: true }) : errorJson(404, "not found");
}

/** DELETE ?id=: delete a chat and its messages; its waiting proposals are dismissed. */
export async function DELETE(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !UUID.test(id)) return errorJson(400, "invalid id");
  return (await deleteConversation(g.user.id, id)) ? Response.json({ ok: true }) : errorJson(404, "not found");
}
