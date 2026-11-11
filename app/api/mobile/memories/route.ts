import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { db, schema } from "@/lib/db";
import { fail, noStore, readJson } from "@/lib/mobile/http";
import { addOwnMemory } from "@/lib/agent/memory";

export const dynamic = "force-dynamic";

/** What the agent remembers about you (same list as the website's memory settings). */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const items = await db()
    .select({ id: schema.memories.id, content: schema.memories.content, kind: schema.memories.kind, updatedAt: schema.memories.updatedAt })
    .from(schema.memories)
    .where(eq(schema.memories.userId, g.user.id))
    .orderBy(desc(schema.memories.updatedAt))
    .limit(200);
  return Response.json({ items }, { headers: noStore });
}

export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = z
    .object({ content: z.string().trim().min(2, "Write at least a few words").max(500), kind: z.enum(["preference", "fact", "person", "project"]).default("preference") })
    .safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid memory");
  const r = await addOwnMemory(g.user.id, parsed.data);
  if (!r.ok) return fail(422, r.message);
  return Response.json({ ok: true, id: r.id, status: r.status }, { headers: noStore });
}
