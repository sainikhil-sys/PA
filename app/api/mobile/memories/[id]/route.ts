import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { db, schema } from "@/lib/db";
import { fail, noStore, readJson } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

async function idFrom(params: Promise<{ id: string }>) {
  const { id } = await params;
  return z.string().uuid().safeParse(id).success ? id : null;
}

/** Correct a memory. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const id = await idFrom(params);
  if (!id) return fail(404, "Not found");
  const parsed = z.object({ content: z.string().trim().min(2, "Write at least a few words").max(500) }).safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid memory");
  const rows = await db()
    .update(schema.memories)
    .set({ content: parsed.data.content })
    .where(and(eq(schema.memories.id, id), eq(schema.memories.userId, g.user.id)))
    .returning({ id: schema.memories.id });
  if (!rows.length) return fail(404, "That memory no longer exists.");
  return Response.json({ ok: true }, { headers: noStore });
}

/** Forget a memory. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const id = await idFrom(params);
  if (!id) return fail(404, "Not found");
  await db().delete(schema.memories).where(and(eq(schema.memories.id, id), eq(schema.memories.userId, g.user.id)));
  return Response.json({ ok: true }, { headers: noStore });
}
