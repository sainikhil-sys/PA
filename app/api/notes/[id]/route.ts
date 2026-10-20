import { apiGuard } from "@/lib/auth/api";
import { getNote } from "@/lib/db/queries/notes";
import { toNoteDetail } from "@/lib/notes/service";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return errorJson(404, "not_found");
  const note = await getNote(g.user.id, id);
  if (!note) return errorJson(404, "not_found");
  return Response.json(toNoteDetail(note), { headers: { "cache-control": "no-store" } });
}
