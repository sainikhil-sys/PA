import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { fail, noStore } from "@/lib/mobile/http";
import { NoteError, refreshBookmark } from "@/lib/notes/links";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";

export const dynamic = "force-dynamic";

/** Fetch a bookmark's page title and description again. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail(404, "That note no longer exists.");
  const rl = await rateLimit("ai", `bookmark:${g.user.id}`);
  if (!rl.success) return rateLimitResponse(rl);
  try {
    return Response.json({ ok: true, ...(await refreshBookmark(g.user.id, id)) }, { headers: noStore });
  } catch (err) {
    if (err instanceof NoteError) return fail(422, err.message);
    throw err;
  }
}
