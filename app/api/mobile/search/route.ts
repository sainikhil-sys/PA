import { and, desc, eq, ilike } from "drizzle-orm";
import { likePattern, listConversations } from "@/lib/agent/chat";
import { apiGuard } from "@/lib/auth/api";
import { db, schema } from "@/lib/db";
import { listNotes } from "@/lib/db/queries/notes";
import { fail, noStore } from "@/lib/mobile/http";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";

export const dynamic = "force-dynamic";

const PER_KIND = 5;

/**
 * GET ?q=: one search across chats, tasks, notes, documents and memories, by keyword (titles and
 * text, case-insensitive). Each result carries its kind and id so the app can open it.
 */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (q.length < 2) return fail(400, "Type at least two letters to search.");
  const rl = await rateLimit("api", `search:${g.user.id}`);
  if (!rl.success) return rateLimitResponse(rl);
  const uid = g.user.id;
  const like = likePattern(q);

  const [chats, tasks, notes, documents, memories] = await Promise.all([
    listConversations(uid, q),
    db()
      .select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status, dueDate: schema.tasks.dueDate })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.userId, uid), ilike(schema.tasks.title, like)))
      .orderBy(desc(schema.tasks.updatedAt))
      .limit(PER_KIND),
    listNotes(uid, { q, limit: PER_KIND }),
    db()
      .select({ id: schema.knowledgeItems.id, title: schema.knowledgeItems.title, url: schema.knowledgeItems.url })
      .from(schema.knowledgeItems)
      .innerJoin(schema.knowledgeSources, eq(schema.knowledgeSources.id, schema.knowledgeItems.sourceId))
      .where(and(eq(schema.knowledgeItems.userId, uid), eq(schema.knowledgeSources.type, "upload"), ilike(schema.knowledgeItems.title, like)))
      .orderBy(desc(schema.knowledgeItems.updatedAt))
      .limit(PER_KIND),
    db()
      .select({ id: schema.memories.id, content: schema.memories.content })
      .from(schema.memories)
      .where(and(eq(schema.memories.userId, uid), ilike(schema.memories.content, like)))
      .orderBy(desc(schema.memories.updatedAt))
      .limit(PER_KIND),
  ]);

  return Response.json(
    {
      q,
      chats: chats.slice(0, PER_KIND).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() })),
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, done: t.status === "done", dueDate: t.dueDate })),
      notes: notes.map((n) => ({ id: n.id, title: n.title, bookmark: Boolean(n.url) })),
      documents: documents.map((d) => ({ id: d.id, title: d.title, url: d.url })),
      memories: memories.map((m) => ({ id: m.id, content: m.content })),
    },
    { headers: noStore },
  );
}
