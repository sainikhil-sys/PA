import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { logActivity } from "@/lib/db/queries/activity";
import { setNotePinned } from "@/lib/db/queries/notes";
import { fail, noStore, readJson } from "@/lib/mobile/http";
import { deleteNote, updateNote } from "@/lib/notes/service";
import { normalizeTags } from "@/lib/notes/text";

export const dynamic = "force-dynamic";

async function idFrom(params: Promise<{ id: string }>) {
  const { id } = await params;
  return z.string().uuid().safeParse(id).success ? id : null;
}

const patchSchema = z.object({
  title: z.string().trim().min(1, "Give the note a title.").max(200).optional(),
  content: z.string().max(50_000, "That note is too long.").optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  pinned: z.boolean().optional(),
});

/** Edit a note's title, text or tags, or pin it. Reading one is GET /api/notes/[id], shared with the web. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const id = await idFrom(params);
  if (!id) return fail(404, "That note no longer exists.");
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid note");
  const { pinned, ...patch } = parsed.data;
  if (patch.title !== undefined || patch.content !== undefined || patch.tags !== undefined) {
    const row = await updateNote(g.user.id, id, { ...patch, ...(patch.tags ? { tags: normalizeTags(patch.tags) } : {}) });
    if (!row) return fail(404, "That note no longer exists.");
  }
  if (pinned !== undefined && !(await setNotePinned(g.user.id, id, pinned))) return fail(404, "That note no longer exists.");
  return Response.json({ ok: true }, { headers: noStore });
}

/** Delete a note (and its copy in the knowledge base). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const id = await idFrom(params);
  if (!id || !(await deleteNote(g.user.id, id))) return fail(404, "That note no longer exists.");
  await logActivity({ userId: g.user.id, actor: "me", tool: "notes.deleted", inputSummary: "note", outcome: "success" });
  return Response.json({ ok: true }, { headers: noStore });
}
