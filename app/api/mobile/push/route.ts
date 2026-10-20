import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { fail, noStore, readJson } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

const token = z.string().min(20).max(4096).regex(/^[\w:.-]+$/);

/**
 * Register this phone's Firebase Cloud Messaging token. Stored as an "fcmapp:" endpoint, the same
 * kind lib/fcm.ts already delivers to as native Android notifications.
 */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = z.object({ token, device: z.string().trim().max(80).optional() }).safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "Invalid token");
  const label = `${parsed.data.device || "Android"} · Cowork app`;
  await db()
    .insert(schema.pushSubscriptions)
    .values({ userId: g.user.id, endpoint: `fcmapp:${parsed.data.token}`, p256dh: "fcm", auth: "fcm", label })
    .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { userId: g.user.id, label } });
  await logActivity({ userId: g.user.id, actor: "me", tool: "devices.fcm_enabled", inputSummary: label, outcome: "success" });
  return Response.json({ ok: true }, { headers: noStore });
}

/** Stop notifications to this phone (sign-out, or turned off in the app). */
export async function DELETE(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = z.object({ token }).safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "Invalid token");
  await db()
    .delete(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.userId, g.user.id), eq(schema.pushSubscriptions.endpoint, `fcmapp:${parsed.data.token}`)));
  return Response.json({ ok: true }, { headers: noStore });
}
