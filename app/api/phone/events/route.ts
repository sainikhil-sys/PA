import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { classifyPhoneEvent } from "@/lib/phone";
import { deviceFromRequest, prunePhoneEvents } from "@/lib/phone-server";
import { rateLimit } from "@/lib/security/ratelimit";

export const dynamic = "force-dynamic";

const event = z.object({
  key: z.string().max(300).optional(),
  package: z.string().max(200).regex(/^[\w.]+$/),
  appName: z.string().max(80),
  category: z.string().max(40).nullable().optional(),
  title: z.string().max(400).default(""),
  text: z.string().max(4000).default(""),
  postedAt: z.number().int().positive(),
});
const body = z.object({
  events: z.array(event).max(50).default([]),
  battery: z.number().int().min(0).max(100).nullable().optional(),
  charging: z.boolean().nullable().optional(),
});

/** Linked phone → Cowork: a batch of notifications plus a heartbeat (battery). Bearer device token. */
export async function POST(req: Request) {
  const device = await deviceFromRequest(req);
  if (!device) return Response.json({ error: "unlinked" }, { status: 401 });
  if (!(await rateLimit("phone", device.id)).success) return Response.json({ error: "slow down" }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { events, battery, charging } = parsed.data;

  await db()
    .update(schema.phoneDevices)
    .set({ lastSeenAt: new Date(), ...(battery != null ? { battery } : {}), ...(charging != null ? { charging } : {}) })
    .where(eq(schema.phoneDevices.id, device.id));

  let stored = 0;
  if (!device.paused && events.length) {
    const now = Date.now();
    const rows = events
      // Ignore clocks far off and anything older than the retention window.
      .filter((e) => e.postedAt > now - 3 * 86_400_000 && e.postedAt < now + 10 * 60_000)
      .map((e) => ({
        userId: device.userId,
        deviceId: device.id,
        kind: classifyPhoneEvent(e.package, e.category),
        appPackage: e.package,
        appName: e.appName.slice(0, 80),
        title: e.title.slice(0, 200),
        text: e.text.slice(0, 1000),
        externalKey: e.key ? `${e.key}:${e.postedAt}` : null,
        postedAt: new Date(e.postedAt),
      }));
    if (rows.length) {
      const inserted = await db().insert(schema.phoneEvents).values(rows).onConflictDoNothing().returning({ id: schema.phoneEvents.id });
      stored = inserted.length;
    }
    if (Math.random() < 0.05) await prunePhoneEvents(device.userId);
  }
  return Response.json({ ok: true, stored, paused: device.paused }, { headers: { "cache-control": "no-store" } });
}
