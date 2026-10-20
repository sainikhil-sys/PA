"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { logActivity } from "@/lib/db/queries/activity";
import { findNoteByUrl, getNote, setNotePinned } from "@/lib/db/queries/notes";
import { fetchLinkPreview } from "@/lib/notes/bookmark";
import { createNote, deleteNote, updateNote } from "@/lib/notes/service";
import { hostOf, normalizeBookmarkUrl, normalizeTags } from "@/lib/notes/text";

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

/**
 * Save a link. The page's title and description are fetched through safeFetch
 * and stored as untrusted plain text. If the fetch fails the link is still
 * saved, linkFetchedAt stays null, and the reason is returned so the UI can say so.
 */
export const saveBookmarkAction = ownerAction(
  z.object({ url: z.string().trim().min(1).max(2000), title: z.string().trim().max(200).optional(), tags: tags.default([]) }),
  async (input, user) => {
    const url = normalizeBookmarkUrl(input.url);
    if (!url) throw new UserFacingError("Enter a web address that starts with http or https.");
    const existing = await findNoteByUrl(user.id, url);
    if (existing) return { id: existing.id, existed: true, fetched: true, reason: null as string | null };

    let meta: { title: string; description: string | null } | null = null;
    let reason: string | null = null;
    try {
      meta = await fetchLinkPreview(url);
    } catch (err) {
      reason = err instanceof Error ? err.message : "Couldn't reach that page";
    }
    const note = await createNote(user.id, {
      title: input.title || meta?.title || hostOf(url),
      content: "",
      url,
      linkDescription: meta?.description ?? null,
      linkFetchedAt: meta ? new Date() : null,
      tags: normalizeTags(input.tags),
      source: "me",
    });
    await logActivity({ userId: user.id, actor: "me", tool: "notes.bookmark_saved", inputSummary: meta ? "bookmark" : "bookmark (details not fetched)", outcome: "success" });
    done();
    return { id: note.id, existed: false, fetched: !!meta, reason };
  },
);

/** Fetch a bookmark's page details again. Failure is reported, never hidden. */
export const refreshBookmarkAction = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  const note = await getNote(user.id, id);
  if (!note) throw new UserFacingError("That note no longer exists.");
  if (!note.url) throw new UserFacingError("This note has no link to fetch.");
  let meta: { title: string; description: string | null };
  try {
    meta = await fetchLinkPreview(note.url);
  } catch (err) {
    throw new UserFacingError(err instanceof Error ? `${err.message}.` : "Couldn't reach that page.");
  }
  await updateNote(user.id, id, {
    linkDescription: meta.description,
    linkFetchedAt: new Date(),
    ...(note.title === hostOf(note.url) ? { title: meta.title.slice(0, 200) } : {}),
  });
  done();
  return { title: meta.title, description: meta.description };
});
