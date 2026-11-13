import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { createNote, listNotes, noteSchema } from "@/lib/spaces/notes";

export const dynamic = "force-dynamic";

/** The Space's shared notes, most recently edited first (titles only): {items}. Members only. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ items: await listNotes(user, param((await params).id, uuidSchema)) }));
}

/** Members who can post: add a note {title, body}. Answers {ok, id, version}. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => createNote(user, param((await params).id, uuidSchema), await body(req, noteSchema)));
}
