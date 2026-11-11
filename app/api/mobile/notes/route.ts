import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { logActivity } from "@/lib/db/queries/activity";
import { fail, noStore, readJson } from "@/lib/mobile/http";
import { createNote } from "@/lib/notes/service";
import { normalizeTags } from "@/lib/notes/text";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  title: z.string().trim().min(1, "Give the note a title.").max(200),
  content: z.string().max(50_000, "That note is too long.").default(""),
  tags: z.array(z.string().max(40)).max(12).default([]),
});

/** Write a note (the list itself is GET /api/notes, shared with the web). Same rules as the web action. */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid note");
  const note = await createNote(g.user.id, { ...parsed.data, tags: normalizeTags(parsed.data.tags), source: "me" });
  await logActivity({ userId: g.user.id, actor: "me", tool: "notes.created", inputSummary: `chars=${parsed.data.content.length}`, outcome: "success" });
  return Response.json({ ok: true, id: note.id }, { headers: noStore });
}
