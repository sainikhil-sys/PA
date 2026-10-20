import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { fail, noStore, readJson } from "@/lib/mobile/http";
import { randomToken, sha256 } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";

/** Phones linked to this account (the app shows whether THIS phone is one of them). */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const devices = await db()
    .select({ id: schema.phoneDevices.id, name: schema.phoneDevices.name, model: schema.phoneDevices.model, paused: schema.phoneDevices.paused, lastSeenAt: schema.phoneDevices.lastSeenAt })
    .from(schema.phoneDevices)
    .where(and(eq(schema.phoneDevices.userId, g.user.id), isNull(schema.phoneDevices.revokedAt)))
    .orderBy(desc(schema.phoneDevices.createdAt));
  return Response.json({ items: devices }, { headers: noStore });
}

/**
 * Links this phone without a pairing code: the app is already signed in, so the account is known.
 * Returns the phone's own device token, used only by its notification listener for /api/phone/events.
 */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = z.object({ name: z.string().trim().min(1).max(60), model: z.string().trim().max(80).optional() }).safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "Invalid request");
  const token = randomToken(32);
  const [device] = await db()
    .insert(schema.phoneDevices)
    .values({ userId: g.user.id, name: parsed.data.name, model: parsed.data.model ?? null, tokenHash: sha256(token), lastSeenAt: new Date() })
    .returning({ id: schema.phoneDevices.id });
  await logActivity({ userId: g.user.id, actor: "me", tool: "phone.linked", inputSummary: `${parsed.data.name} (Android app)`, outcome: "success" });
  return Response.json({ ok: true, token, deviceId: device!.id }, { headers: noStore });
}

/** Unlink a phone: its token stops working immediately. */
export async function DELETE(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = z.object({ deviceId: z.string().uuid() }).safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "Invalid request");
  await db()
    .update(schema.phoneDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.phoneDevices.id, parsed.data.deviceId), eq(schema.phoneDevices.userId, g.user.id), isNull(schema.phoneDevices.revokedAt)));
  await logActivity({ userId: g.user.id, actor: "me", tool: "phone.unlinked", inputSummary: "Android app", outcome: "success" });
  return Response.json({ ok: true }, { headers: noStore });
}
