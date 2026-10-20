import "server-only";
import { and, eq } from "drizzle-orm";
import type { NoteDetail, NoteRow } from "@/components/notes/types";
import { db, schema } from "@/lib/db";
import type { Note } from "@/lib/db/schema";
import { deleteNoteRow, getNote, markNoteIndexed, notesNeedingIndex, saveNote, updateNoteRow, type NoteInput } from "@/lib/db/queries/notes";
import { getSettings } from "@/lib/db/queries/settings";
import { ensureSource, refreshSourceCount, upsertItem } from "@/lib/knowledge/ingest";
import { errMessage, log } from "@/lib/log";
import { hostOf, noteIndexText, plainExcerpt } from "./text";

/**
 * The one place that writes notes. The `notes` table is the source of truth;
 * each note is mirrored into the knowledge "Notes" source (externalId
 * `note:<id>`) so chat context, citations and MCP search_knowledge find it.
 * A failed mirror never fails the save: indexedAt stays null and the Notes
 * page retries it later.
 */

export const NOTES_SOURCE = { type: "text", name: "Notes" } as const;

export function noteHref(id: string) {
  return `/knowledge/notes?note=${id}`;
}

type IndexableNote = Pick<Note, "id" | "userId" | "title" | "content" | "url" | "linkDescription" | "tags" | "updatedAt">;

export async function indexNote(note: IndexableNote) {
  const source = await ensureSource(note.userId, NOTES_SOURCE.type, NOTES_SOURCE.name);
  const externalId = `note:${note.id}`;
  const existing = await db().query.knowledgeItems.findFirst({
    where: and(eq(schema.knowledgeItems.sourceId, source.id), eq(schema.knowledgeItems.externalId, externalId)),
  });
  // upsertItem hashes only the text, so a title-only edit would keep the old title. Recreate instead.
  if (existing && existing.title !== (note.title.slice(0, 300) || "Untitled")) {
    await db().delete(schema.knowledgeItems).where(eq(schema.knowledgeItems.id, existing.id));
  }
  await upsertItem(
    source,
    { externalId, title: note.title, url: noteHref(note.id), mimeType: "text/markdown", text: noteIndexText(note), sourceUpdatedAt: note.updatedAt },
    { emit: false },
  );
  await refreshSourceCount(source.id);
  await markNoteIndexed(note.id);
}

export async function unindexNote(userId: string, noteId: string) {
  const source = await db().query.knowledgeSources.findFirst({
    where: and(eq(schema.knowledgeSources.userId, userId), eq(schema.knowledgeSources.type, NOTES_SOURCE.type), eq(schema.knowledgeSources.name, NOTES_SOURCE.name)),
  });
  if (!source) return;
  await db().delete(schema.knowledgeItems).where(and(eq(schema.knowledgeItems.sourceId, source.id), eq(schema.knowledgeItems.externalId, `note:${noteId}`)));
  await refreshSourceCount(source.id);
}

async function tryIndex(note: IndexableNote) {
  try {
    await indexNote(note);
  } catch (err) {
    log.warn("notes.index_failed", { error: errMessage(err) });
  }
}

export async function createNote(userId: string, input: NoteInput) {
  const note = await saveNote(userId, input);
  await tryIndex(note);
  return note;
}

export async function updateNote(
  userId: string,
  id: string,
  patch: Partial<{ title: string; content: string; tags: string[]; linkDescription: string | null; linkFetchedAt: Date | null }>,
) {
  const current = await getNote(userId, id);
  if (!current) return null;
  const reembed = (patch.title !== undefined && patch.title !== current.title) || (patch.content !== undefined && patch.content !== current.content);
  const row = await updateNoteRow(userId, id, patch, reembed);
  if (row) await tryIndex(row);
  return row;
}

export async function deleteNote(userId: string, id: string) {
  await unindexNote(userId, id);
  return (await deleteNoteRow(userId, id)) !== null;
}

/** Copies notes that aren't in the knowledge base yet. Sequential, one failure doesn't stop the rest. */
export async function indexMissingNotes(userId: string, limit = 20) {
  let n = 0;
  for (const note of await notesNeedingIndex(userId, limit)) {
    try {
      await indexNote(note);
      n++;
    } catch (err) {
      log.warn("notes.index_failed", { error: errMessage(err) });
    }
  }
  return n;
}

/** Whether chat can actually see notes: the Notes source is included and knowledge search is on. */
export async function notesIndexState(userId: string) {
  const [source, settings] = await Promise.all([
    db().query.knowledgeSources.findFirst({
      where: and(eq(schema.knowledgeSources.userId, userId), eq(schema.knowledgeSources.type, NOTES_SOURCE.type), eq(schema.knowledgeSources.name, NOTES_SOURCE.name)),
    }),
    getSettings(userId),
  ]);
  return { sourceIncluded: source ? source.included : null, agentCanSearch: settings.agent.capabilities.searchKnowledge !== false };
}

type RowLike = Pick<Note, "id" | "title" | "content" | "url" | "linkDescription" | "tags" | "pinned" | "source" | "createdAt" | "updatedAt">;

export function toNoteRow(n: RowLike): NoteRow {
  return {
    id: n.id,
    title: n.title,
    excerpt: plainExcerpt(n.content),
    url: n.url,
    host: n.url ? hostOf(n.url) : null,
    linkDescription: n.linkDescription,
    tags: n.tags,
    pinned: n.pinned,
    source: n.source,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

export function toNoteDetail(n: RowLike & Pick<Note, "linkFetchedAt" | "indexedAt">): NoteDetail {
  return { ...toNoteRow(n), content: n.content, linkFetchedAt: n.linkFetchedAt?.toISOString() ?? null, indexedAt: n.indexedAt?.toISOString() ?? null };
}
