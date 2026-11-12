import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getOwner } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { errorJson, isSameOrigin } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/** Hides an announcement for the signed-in person on every device. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bearer = /^Bearer /.test(req.headers.get("authorization") ?? "");
  if (!bearer && !isSameOrigin(req)) return errorJson(403, "forbidden");
  const user = await getOwner();
  if (!user) return errorJson(401, "unauthorized");
  const rl = await rateLimit("api", `user:${user.id}`);
  if (!rl.success) return rateLimitResponse(rl);
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) return errorJson(404, "That announcement doesn't exist.", { code: "not_found" });
  const [a] = await db()
    .select({ dismissible: schema.systemAnnouncements.dismissible })
    .from(schema.systemAnnouncements)
    .where(and(eq(schema.systemAnnouncements.id, id.data), isNull(schema.systemAnnouncements.archivedAt)))
    .limit(1);
  if (!a) return errorJson(404, "That announcement doesn't exist.", { code: "not_found" });
  if (!a.dismissible) return errorJson(400, "This announcement can't be hidden.", { code: "not_dismissible" });
  await db().insert(schema.announcementDismissals).values({ userId: user.id, announcementId: id.data }).onConflictDoNothing();
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
