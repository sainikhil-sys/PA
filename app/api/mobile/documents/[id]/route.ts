import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { db, schema } from "@/lib/db";
import { refreshSourceCount } from "@/lib/knowledge/ingest";
import { fail, noStore } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

/**
 * Remove one document from your knowledge base. Listing uses GET /api/knowledge/items and
 * uploading uses POST /api/knowledge/upload, both shared with the web.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail(404, "Not found");
  const [item] = await db()
    .delete(schema.knowledgeItems)
    .where(and(eq(schema.knowledgeItems.id, id), eq(schema.knowledgeItems.userId, g.user.id)))
    .returning({ sourceId: schema.knowledgeItems.sourceId });
  if (item) await refreshSourceCount(item.sourceId);
  return Response.json({ ok: true }, { headers: noStore });
}
