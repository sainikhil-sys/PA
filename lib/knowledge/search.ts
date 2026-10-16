import "server-only";
import { and, cosineDistance, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { embedText } from "@/lib/ai/router";
import { db, schema } from "@/lib/db";
import { reciprocalRankFusion } from "./rank";

export type KnowledgeHit = {
  id: string;
  itemId: string;
  sourceId: string;
  sourceType: string;
  title: string;
  url: string | null;
  content: string;
  score: number;
};

async function includedSourceIds(userId: string, sourceTypes?: string[]) {
  const conds = [eq(schema.knowledgeSources.userId, userId), eq(schema.knowledgeSources.included, true)];
  if (sourceTypes?.length) conds.push(inArray(schema.knowledgeSources.type, sourceTypes));
  const rows = await db().select({ id: schema.knowledgeSources.id, type: schema.knowledgeSources.type }).from(schema.knowledgeSources).where(and(...conds));
  return new Map(rows.map((r) => [r.id, r.type]));
}

/**
 * Hybrid retrieval: Postgres full-text (ts_rank) + pgvector cosine, merged with
 * Reciprocal Rank Fusion. Only sources with "include" switched on are searched.
 */
export async function searchKnowledge(userId: string, query: string, opts: { limit?: number; sourceTypes?: string[] } = {}): Promise<{ mode: "hybrid" | "keyword"; results: KnowledgeHit[] }> {
  const limit = Math.min(opts.limit ?? 6, 20);
  const sources = await includedSourceIds(userId, opts.sourceTypes);
  if (!sources.size) return { mode: "keyword", results: [] };
  const sourceIds = [...sources.keys()];
  const c = schema.knowledgeChunks;
  const cols = { id: c.id, itemId: c.itemId, sourceId: c.sourceId, content: c.content, title: schema.knowledgeItems.title, url: schema.knowledgeItems.url };

  const tsq = sql`websearch_to_tsquery('english', ${query})`;
  const keyword = await db()
    .select({ ...cols, score: sql<number>`ts_rank(${c.tsv}, ${tsq})` })
    .from(c)
    .innerJoin(schema.knowledgeItems, eq(schema.knowledgeItems.id, c.itemId))
    .where(and(eq(c.userId, userId), inArray(c.sourceId, sourceIds), sql`${c.tsv} @@ ${tsq}`))
    .orderBy(desc(sql`ts_rank(${c.tsv}, ${tsq})`))
    .limit(limit * 2);

  const embedding = await embedText(query, { kind: "embed_query", userId });
  let vector: typeof keyword = [];
  if (embedding) {
    const distance = cosineDistance(c.embedding, embedding);
    vector = await db()
      .select({ ...cols, score: sql<number>`1 - (${distance})` })
      .from(c)
      .innerJoin(schema.knowledgeItems, eq(schema.knowledgeItems.id, c.itemId))
      .where(and(eq(c.userId, userId), inArray(c.sourceId, sourceIds), isNotNull(c.embedding)))
      .orderBy(distance)
      .limit(limit * 2);
  }

  const fused = reciprocalRankFusion([vector, keyword]).slice(0, limit);
  return {
    mode: embedding ? "hybrid" : "keyword",
    results: fused.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      sourceId: r.sourceId,
      sourceType: sources.get(r.sourceId) ?? "unknown",
      title: r.title,
      url: r.url,
      content: r.content,
      score: Number(r.score) || 0,
    })),
  };
}
