import "server-only";
import { logActivity } from "@/lib/db/queries/activity";
import { findNoteByUrl, getNote } from "@/lib/db/queries/notes";
import { fetchLinkPreview } from "./bookmark";
import { createNote, updateNote } from "./service";
import { hostOf, normalizeBookmarkUrl, normalizeTags } from "./text";

/** A problem the person can act on; the message is shown as-is (web action or app route). */
export class NoteError extends Error {}

/**
 * Save a link. The page's title and description are fetched through safeFetch and stored as
 * untrusted plain text. If the fetch fails the link is still saved, linkFetchedAt stays null, and the
 * reason is returned so the caller can say so. Shared by the website and the app.
 */
export async function saveBookmark(userId: string, input: { url: string; title?: string; tags?: string[] }) {
  const url = normalizeBookmarkUrl(input.url);
  if (!url) throw new NoteError("Enter a web address that starts with http or https.");
  const existing = await findNoteByUrl(userId, url);
  if (existing) return { id: existing.id, existed: true, fetched: true, reason: null as string | null };

  let meta: { title: string; description: string | null } | null = null;
  let reason: string | null = null;
  try {
    meta = await fetchLinkPreview(url);
  } catch (err) {
    reason = err instanceof Error ? err.message : "Couldn't reach that page";
  }
  const note = await createNote(userId, {
    title: input.title || meta?.title || hostOf(url),
    content: "",
    url,
    linkDescription: meta?.description ?? null,
    linkFetchedAt: meta ? new Date() : null,
    tags: normalizeTags(input.tags ?? []),
    source: "me",
  });
  await logActivity({ userId, actor: "me", tool: "notes.bookmark_saved", inputSummary: meta ? "bookmark" : "bookmark (details not fetched)", outcome: "success" });
  return { id: note.id, existed: false, fetched: !!meta, reason };
}

/** Fetch a bookmark's page details again. Failure is reported, never hidden. */
export async function refreshBookmark(userId: string, id: string) {
  const note = await getNote(userId, id);
  if (!note) throw new NoteError("That note no longer exists.");
  if (!note.url) throw new NoteError("This note has no link to fetch.");
  let meta: { title: string; description: string | null };
  try {
    meta = await fetchLinkPreview(note.url);
  } catch (err) {
    throw new NoteError(err instanceof Error ? `${err.message}.` : "Couldn't reach that page.");
  }
  await updateNote(userId, id, {
    linkDescription: meta.description,
    linkFetchedAt: new Date(),
    ...(note.title === hostOf(note.url) ? { title: meta.title.slice(0, 200) } : {}),
  });
  return { title: meta.title, description: meta.description };
}
