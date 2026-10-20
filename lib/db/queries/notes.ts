import "server-only";
import { and, arrayContains, cosineDistance, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { embedText } from "@/lib/ai/router";
import { db, rowsOf, schema } from "@/lib/db";
import type { Actor } from "@/lib/db/schema";
import { searchTerms } from "@/lib/notes/text";

/**
 * DB layer for notes and bookmarks. Writes that should also reach the
 * knowledge base go through lib/notes/service.ts, not these functions.
 */

const NOTE_COLS = {
  id: schema.notes.id,
  title: schema.notes.title,
  content: schema.notes.content,
  url: schema.notes.url,
  linkDescription: schema.notes.linkDescription,
  linkFetchedAt: schema.notes.linkFetchedAt,
  tags: schema.notes.tags,
  pinned: schema.notes.pinned,
  source: schema.notes.source,
  indexedAt: schema.notes.indexedAt,
  createdAt: schema.notes.createdAt,
  updatedAt: schema.notes.updatedAt,
};

/** Keeps updatedAt as it was (the column helper bumps it on every update otherwise). */
const KEEP_UPDATED_AT = sql`${schema.notes.updatedAt}`;

export type NoteInput = {
  title: string;
  content: string;
  source: Actor;
  url?: string | null;
  linkDescription?: string | null;
  linkFetchedAt?: Date | null;
  tags?: string[];
  pinned?: boolean;
};

export async function saveNote(userId: string, input: NoteInput) {
  const embedding = await embedText(`${input.title}\n\n${input.content}`, { kind: "embed_note", userId });
  const [note] = await db()
    .insert(schema.notes)
    .values({
      userId,
      title: input.title,
      content: input.content,
      source: input.source,
      embedding,
      url: input.url ?? null,
      linkDescription: input.linkDescription ?? null,
      linkFetchedAt: input.linkFetchedAt ?? null,
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
    })
    .returning();
  return note!;
}

export async function getNote(userId: string, id: string) {
  return (await db().query.notes.findFirst({ where: and(eq(schema.notes.id, id), eq(schema.notes.userId, userId)) })) ?? null;
}

export async function findNoteByUrl(userId: string, url: string) {
  const [row] = await db().select({ id: schema.notes.id }).from(schema.notes).where(and(eq(schema.notes.userId, userId), eq(schema.notes.url, url))).limit(1);
  return row ?? null;
}

export async function updateNoteRow(
  userId: string,
  id: string,
  patch: Partial<{ title: string; content: string; tags: string[]; linkDescription: string | null; linkFetchedAt: Date | null }>,
  reembed: boolean,
) {
  const set: Partial<typeof schema.notes.$inferInsert> = { ...patch, indexedAt: null };
  if (reembed) {
    const current = await getNote(userId, id);
    if (!current) return null;
    set.embedding = await embedText(`${patch.title ?? current.title}\n\n${patch.content ?? current.content}`, { kind: "embed_note", userId });
  }
  const [row] = await db().update(schema.notes).set(set).where(and(eq(schema.notes.id, id), eq(schema.notes.userId, userId))).returning();
  return row ?? null;
}

/** Pinning doesn't count as an edit, so it doesn't reorder by recency. */
export async function setNotePinned(userId: string, id: string, pinned: boolean) {
  const [row] = await db()
    .update(schema.notes)
    .set({ pinned, updatedAt: KEEP_UPDATED_AT })
    .where(and(eq(schema.notes.id, id), eq(schema.notes.userId, userId)))
    .returning({ id: schema.notes.id });
  return !!row;
}

export async function markNoteIndexed(id: string) {
  await db().update(schema.notes).set({ indexedAt: new Date(), updatedAt: KEEP_UPDATED_AT }).where(eq(schema.notes.id, id));
}

export async function deleteNoteRow(userId: string, id: string) {
  const [row] = await db().delete(schema.notes).where(and(eq(schema.notes.id, id), eq(schema.notes.userId, userId))).returning({ id: schema.notes.id });
  return row?.id ?? null;
}

/** Notes not yet copied into the knowledge base (new, edited, legacy MCP notes, or a failed copy). */
export async function notesNeedingIndex(userId: string, limit = 20) {
  return db()
    .select()
    .from(schema.notes)
    .where(and(eq(schema.notes.userId, userId), isNull(schema.notes.indexedAt)))
    .orderBy(desc(schema.notes.updatedAt))
    .limit(limit);
}

function termConditions(q: string | undefined): SQL[] {
  return searchTerms(q ?? "").map(
    (p) => or(ilike(schema.notes.title, p), ilike(schema.notes.content, p), ilike(schema.notes.url, p), sql`array_to_string(${schema.notes.tags}, ' ') ilike ${p}`)!,
  );
}

export async function listNotes(userId: string, opts: { q?: string; tag?: string; kind?: "all" | "notes" | "bookmarks"; limit?: number } = {}) {
  const where: SQL[] = [eq(schema.notes.userId, userId)];
  if (opts.kind === "notes") where.push(isNull(schema.notes.url));
  if (opts.kind === "bookmarks") where.push(isNotNull(schema.notes.url));
  if (opts.tag) where.push(arrayContains(schema.notes.tags, [opts.tag]));
  where.push(...termConditions(opts.q));
  return db()
    .select(NOTE_COLS)
    .from(schema.notes)
    .where(and(...where))
    .orderBy(desc(schema.notes.pinned), desc(schema.notes.updatedAt))
    .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
}

export async function noteTagCounts(userId: string, limit = 50) {
  return rowsOf<{ tag: string; n: number }>(
    await db().execute(
      sql`select t.tag, count(*)::int as n from ${schema.notes}, unnest(${schema.notes.tags}) as t(tag) where ${schema.notes.userId} = ${userId} group by t.tag order by n desc, t.tag asc limit ${limit}`,
    ),
  );
}

/**
 * Semantic search (pgvector cosine) when embeddings are configured,
 * otherwise a keyword fallback so search_memory always works.
 */
export async function searchNotes(userId: string, query: string, limit = 8) {
  const embedding = await embedText(query, { kind: "embed_query", userId });
  const cols = {
    id: schema.notes.id,
    title: schema.notes.title,
    content: schema.notes.content,
    url: schema.notes.url,
    source: schema.notes.source,
    createdAt: schema.notes.createdAt,
  };
  if (embedding) {
    const distance = cosineDistance(schema.notes.embedding, embedding);
    const rows = await db()
      .select({ ...cols, score: sql<number>`1 - (${distance})` })
      .from(schema.notes)
      .where(and(eq(schema.notes.userId, userId), isNotNull(schema.notes.embedding)))
      .orderBy(distance)
      .limit(limit);
    if (rows.length) return { mode: "semantic" as const, results: rows };
  }
  const rows = await db()
    .select({ ...cols, score: sql<number>`0` })
    .from(schema.notes)
    .where(and(eq(schema.notes.userId, userId), ...termConditions(query)))
    .orderBy(desc(schema.notes.createdAt))
    .limit(limit);
  return { mode: "keyword" as const, results: rows };
}
