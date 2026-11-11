"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { logActivity } from "@/lib/db/queries/activity";
import { setNotePinned } from "@/lib/db/queries/notes";
import { NoteError, refreshBookmark, saveBookmark } from "@/lib/notes/links";
import { createNote, deleteNote, updateNote } from "@/lib/notes/service";
import { normalizeTags } from "@/lib/notes/text";

const uuid = z.string().uuid();
const title = z.string().trim().min(1, "Give the note a title.").max(200);
const content = z.string().max(50_000);
const tags = z.array(z.string().max(40)).max(12);

function done() {
  revalidatePath("/knowledge/notes");
  revalidatePath("/knowledge");
}

export const createNoteAction = ownerAction(
  z.object({ title, content: content.default(""), tags: tags.default([]), pinned: z.boolean().default(false) }),
  async (input, user) => {
    const note = await createNote(user.id, { ...input, tags: normalizeTags(input.tags), source: "me" });
    await logActivity({ userId: user.id, actor: "me", tool: "notes.created", inputSummary: `chars=${input.content.length}`, outcome: "success" });
    done();
    return { id: note.id };
  },
);

export const updateNoteAction = ownerAction(z.object({ id: uuid, title: title.optional(), content: content.optional(), tags: tags.optional() }), async ({ id, ...patch }, user) => {
  const row = await updateNote(user.id, id, { ...patch, ...(patch.tags ? { tags: normalizeTags(patch.tags) } : {}) });
  if (!row) throw new UserFacingError("That note no longer exists.");
  done();
  return { id: row.id };
});

export const setNotePinnedAction = ownerAction(z.object({ id: uuid, pinned: z.boolean() }), async ({ id, pinned }, user) => {
  if (!(await setNotePinned(user.id, id, pinned))) throw new UserFacingError("That note no longer exists.");
  done();
});

export const deleteNoteAction = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  if (!(await deleteNote(user.id, id))) throw new UserFacingError("That note no longer exists.");
  await logActivity({ userId: user.id, actor: "me", tool: "notes.deleted", inputSummary: "note", outcome: "success" });
  done();
});

/** Save a link (shared with the app: lib/notes/links.ts). */
export const saveBookmarkAction = ownerAction(
  z.object({ url: z.string().trim().min(1).max(2000), title: z.string().trim().max(200).optional(), tags: tags.default([]) }),
  async (input, user) => {
    try {
      const res = await saveBookmark(user.id, input);
      if (!res.existed) done();
      return res;
    } catch (err) {
      if (err instanceof NoteError) throw new UserFacingError(err.message);
      throw err;
    }
  },
);

/** Fetch a bookmark's page details again. Failure is reported, never hidden. */
export const refreshBookmarkAction = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  try {
    const res = await refreshBookmark(user.id, id);
    done();
    return res;
  } catch (err) {
    if (err instanceof NoteError) throw new UserFacingError(err.message);
    throw err;
  }
});
