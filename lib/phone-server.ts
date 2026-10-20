import "server-only";
import { randomInt } from "node:crypto";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { sha256 } from "@/lib/security/crypto";
import { PAIR_ALPHABET } from "./phone";

export const PHONE_RETENTION_MS = 3 * 86_400_000;

export function newPairCode(): string {
  return Array.from({ length: 6 }, () => PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)]).join("");
}

/** The linked phone behind a request's Bearer token, or null (revoked/unknown). */
export async function deviceFromRequest(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = /^Bearer ([A-Za-z0-9_-]{30,200})$/.exec(auth)?.[1];
  if (!token) return null;
  const [d] = await db()
    .select()
    .from(schema.phoneDevices)
    .where(and(eq(schema.phoneDevices.tokenHash, sha256(token)), isNull(schema.phoneDevices.revokedAt)))
    .limit(1);
  return d ?? null;
}

export async function listPhoneFeed(userId: string, limit = 80) {
  const [devices, events] = await Promise.all([
    db().select().from(schema.phoneDevices).where(and(eq(schema.phoneDevices.userId, userId), isNull(schema.phoneDevices.revokedAt))).orderBy(desc(schema.phoneDevices.createdAt)),
    db().select().from(schema.phoneEvents).where(and(eq(schema.phoneEvents.userId, userId), gte(schema.phoneEvents.postedAt, new Date(Date.now() - PHONE_RETENTION_MS)))).orderBy(desc(schema.phoneEvents.postedAt)).limit(limit),
  ]);
  return {
    devices: devices.map((d) => ({ id: d.id, name: d.name, model: d.model, battery: d.battery, charging: d.charging, paused: d.paused, lastSeenAt: d.lastSeenAt?.toISOString() ?? null, createdAt: d.createdAt.toISOString() })),
    events: events.map((e) => ({ id: e.id, deviceId: e.deviceId, kind: e.kind, appName: e.appName, appPackage: e.appPackage, title: e.title, text: e.text, postedAt: e.postedAt.toISOString(), read: Boolean(e.readAt) })),
  };
}

export type PhoneFeed = Awaited<ReturnType<typeof listPhoneFeed>>;

/** Phone content is personal and from third parties: keep only a short window. */
/** Every account's phone events older than the 3-day retention (run by the cron dispatcher). */
export async function pruneAllPhoneEvents() {
  await db().delete(schema.phoneEvents).where(lt(schema.phoneEvents.postedAt, new Date(Date.now() - PHONE_RETENTION_MS)));
}

export async function prunePhoneEvents(userId: string) {
  await db().delete(schema.phoneEvents).where(and(eq(schema.phoneEvents.userId, userId), lt(schema.phoneEvents.postedAt, new Date(Date.now() - PHONE_RETENTION_MS))));
}
