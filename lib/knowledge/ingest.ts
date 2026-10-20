import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { embedText } from "@/lib/ai/router";
import { db, schema } from "@/lib/db";
import type { KnowledgeSource } from "@/lib/db/schema";
import { emitEvent } from "@/lib/automations/events";
import { sha256 } from "@/lib/security/crypto";
import { stripInvisible } from "@/lib/security/sanitize";
import { chunkText } from "./rank";

export const MAX_ITEM_CHARS = 200_000;
const MAX_CHUNKS_PER_ITEM = 120;

export async function ensureSource(userId: string, type: string, name: string, config: Record<string, unknown> = {}): Promise<KnowledgeSource> {
  const existing = await db().query.knowledgeSources.findFirst({
    where: and(eq(schema.knowledgeSources.userId, userId), eq(schema.knowledgeSources.type, type), eq(schema.knowledgeSources.name, name)),
  });
  if (existing) return existing;
  const [row] = await db().insert(schema.knowledgeSources).values({ userId, type, name, config }).returning();
  return row!;
}

export function cleanText(raw: string): string {
  return stripInvisible(raw).replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_ITEM_CHARS);
}

/**
 * Ingest one item: clean -> dedupe by content hash -> chunk -> embed -> store.
 * Unchanged content is skipped; changed content is re-chunked and re-embedded.
 */
export async function upsertItem(
  source: KnowledgeSource,
  item: { externalId: string; title: string; url?: string | null; mimeType?: string | null; text: string; sourceUpdatedAt?: Date | null },
  /** emit:false skips the knowledge_item automation event (notes use it, so add_note can't re-trigger itself). */
  opts: { emit?: boolean } = {},
): Promise<"created" | "updated" | "unchanged" | "empty"> {
  const text = cleanText(item.text);
  if (!text) return "empty";
  const hash = sha256(text);
  const existing = await db().query.knowledgeItems.findFirst({
    where: and(eq(schema.knowledgeItems.sourceId, source.id), eq(schema.knowledgeItems.externalId, item.externalId)),
  });
  if (existing?.contentHash === hash) return "unchanged";

  const values = {
    title: item.title.slice(0, 300) || "Untitled",
    url: item.url ?? null,
    mimeType: item.mimeType ?? null,
    contentHash: hash,
    chars: text.length,
    sourceUpdatedAt: item.sourceUpdatedAt ?? null,
  };
  const [row] = existing
    ? await db().update(schema.knowledgeItems).set(values).where(eq(schema.knowledgeItems.id, existing.id)).returning()
    : await db().insert(schema.knowledgeItems).values({ userId: source.userId, sourceId: source.id, externalId: item.externalId, ...values }).returning();
  const itemId = row!.id;
  if (existing) await db().delete(schema.knowledgeChunks).where(eq(schema.knowledgeChunks.itemId, itemId));

  const chunks = chunkText(`${values.title}\n\n${text}`).slice(0, MAX_CHUNKS_PER_ITEM);
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedText(chunks[i]!, { kind: "embed_chunk", userId: source.userId });
    await db().insert(schema.knowledgeChunks).values({ userId: source.userId, itemId, sourceId: source.id, idx: i, content: chunks[i]!, embedding });
  }
  if (!existing && opts.emit !== false) {
    await emitEvent(source.userId, { type: "knowledge_item", key: itemId, sourceType: source.type, title: values.title, itemId }).catch(() => 0);
  }
  return existing ? "updated" : "created";
}

export async function refreshSourceCount(sourceId: string) {
  await db()
    .update(schema.knowledgeSources)
    .set({ itemCount: sql`(select count(*)::int from knowledge_items where source_id = ${sourceId})` })
    .where(eq(schema.knowledgeSources.id, sourceId));
}

/** Pasted text / agent notes go into a built-in "Notes" source. */
export async function addTextToKnowledge(userId: string, input: { title: string; content: string; via: "me" | "agent" | "claude" }) {
  const source = await ensureSource(userId, "text", "Notes");
  const result = await upsertItem(source, { externalId: `${input.via}:${sha256(input.title + input.content).slice(0, 24)}`, title: input.title, text: input.content, mimeType: "text/plain" });
  await refreshSourceCount(source.id);
  return result;
}

/** "Delete synced data": removes items and chunks for a source but keeps the source row. */
export async function deleteSourceData(userId: string, sourceId: string) {
  await db().delete(schema.knowledgeItems).where(and(eq(schema.knowledgeItems.userId, userId), eq(schema.knowledgeItems.sourceId, sourceId)));
  await db().update(schema.knowledgeSources).set({ itemCount: 0, cursor: null, lastSyncAt: null }).where(and(eq(schema.knowledgeSources.id, sourceId), eq(schema.knowledgeSources.userId, userId)));
}
