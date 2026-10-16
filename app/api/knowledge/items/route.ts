import { and, desc, eq, ilike } from "drizzle-orm";
import { apiGuard } from "@/lib/auth/api";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Item browser: titles and metadata only (no raw document text). */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.slice(0, 100) ?? "";
  const source = url.searchParams.get("source");
  const conds = [eq(schema.knowledgeItems.userId, g.user.id)];
  if (q) conds.push(ilike(schema.knowledgeItems.title, `%${q.replace(/[%_\\]/g, "")}%`));
  if (source && /^[0-9a-f-]{36}$/i.test(source)) conds.push(eq(schema.knowledgeItems.sourceId, source));
  const items = await db()
    .select({ id: schema.knowledgeItems.id, title: schema.knowledgeItems.title, url: schema.knowledgeItems.url, chars: schema.knowledgeItems.chars, sourceId: schema.knowledgeItems.sourceId, updatedAt: schema.knowledgeItems.updatedAt })
    .from(schema.knowledgeItems)
    .where(and(...conds))
    .orderBy(desc(schema.knowledgeItems.updatedAt))
    .limit(50);
  return Response.json({ items }, { headers: { "cache-control": "no-store" } });
}
