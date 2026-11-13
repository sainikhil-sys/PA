import { noStore } from "@/lib/mobile/http";
import { body, handle, param, uuidSchema } from "@/lib/social/http";
import { CONFLICT_MESSAGE, deleteNote, getNote, noteUpdateSchema, type NoteView, updateNote } from "@/lib/spaces/notes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; noteId: string }> };

async function ids(params: Params["params"]) {
  const p = await params;
  return { spaceId: param(p.id, uuidSchema), noteId: param(p.noteId, uuidSchema) };
}

/** One note with its text and version. */
export async function GET(req: Request, { params }: Params) {
  return handle(req, async (user) => {
    const { spaceId, noteId } = await ids(params);
    return getNote(user, spaceId, noteId);
  });
}

/**
 * Saves an edit {title, body, version}, where version is the one the edit started from. If someone
 * saved in between: 409 {ok: false, message, code: "version_conflict", latest}, where latest has
 * the same shape GET returns, so the app can show both and let the person merge.
 */
export async function PUT(req: Request, { params }: Params) {
  let conflict: NoteView | null = null;
  const res = await handle(req, async (user) => {
    const { spaceId, noteId } = await ids(params);
    const out = await updateNote(user, spaceId, noteId, await body(req, noteUpdateSchema));
    if ("conflict" in out) {
      conflict = out.conflict;
      return null;
    }
    return { ok: true, note: out.note };
  });
  // Same error shape as every other failure ({ok: false, message}), plus a code and the latest note
  // exactly as GET returns it.
  if (conflict) return Response.json({ ok: false, message: CONFLICT_MESSAGE, code: "version_conflict", latest: conflict }, { status: 409, headers: noStore });
  return res;
}

export const PATCH = PUT;

/** Whoever created the note, or the Space's owners and moderators. */
export async function DELETE(req: Request, { params }: Params) {
  return handle(req, async (user) => {
    const { spaceId, noteId } = await ids(params);
    await deleteNote(user, spaceId, noteId);
    return { ok: true };
  });
}
