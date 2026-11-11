import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { fail, noStore, readJson } from "@/lib/mobile/http";
import { NoteError, saveBookmark } from "@/lib/notes/links";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  url: z.string().trim().min(1, "Enter a web address.").max(2000),
  title: z.string().trim().max(200).optional(),
  tags: z.array(z.string().max(40)).max(12).default([]),
});

/** Save a link as a bookmark note. Says when the page's details couldn't be fetched. */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid link");
  const rl = await rateLimit("ai", `bookmark:${g.user.id}`);
  if (!rl.success) return rateLimitResponse(rl);
  try {
    return Response.json({ ok: true, ...(await saveBookmark(g.user.id, parsed.data)) }, { headers: noStore });
  } catch (err) {
    if (err instanceof NoteError) return fail(422, err.message);
    throw err;
  }
}
