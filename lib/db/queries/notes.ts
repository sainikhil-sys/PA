import "server-only";
import { and, cosineDistance, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { embedText } from "@/lib/ai/router";
import { db, schema } from "@/lib/db";
import type { Actor } from "@/lib/db/schema";

export async function saveNote(userId: string, input: { title: string; content: string; source: Actor }) {
  const embedding = await embedText(`${input.title}\n\n${input.content}`, { kind: "embed_note", userId });
  const [note] = await db()
    .insert(schema.notes)
    .values({ userId, title: input.title, content: input.content, source: input.source, embedding })
    .returning({ id: schema.notes.id, title: schema.notes.title, createdAt: schema.notes.createdAt });
  return note!;
}

export async function listNotes(userId: string, limit = 50) {
  return db()
    .select({
      id: schema.notes.id,
      title: schema.notes.title,
      content: schema.notes.content,
      source: schema.notes.source,
      createdAt: schema.notes.createdAt,
    })
    .from(schema.notes)
    .where(eq(schema.notes.userId, userId))
    .orderBy(desc(schema.notes.createdAt))
    .limit(limit);
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
  const pattern = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await db()
    .select({ ...cols, score: sql<number>`0` })
    .from(schema.notes)
    .where(and(eq(schema.notes.userId, userId), or(ilike(schema.notes.title, pattern), ilike(schema.notes.content, pattern))))
    .orderBy(desc(schema.notes.createdAt))
    .limit(limit);
  return { mode: "keyword" as const, results: rows };
}
