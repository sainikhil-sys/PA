import "server-only";
import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { sendFcm } from "@/lib/fcm";
import { errMessage, log } from "@/lib/log";

let configured: boolean | undefined;

export function pushConfigured(): boolean {
  if (configured !== undefined) return configured;
  const e = env();
  configured = Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
  if (configured) webpush.setVapidDetails(e.VAPID_SUBJECT ?? "https://antropic.me", e.VAPID_PUBLIC_KEY!, e.VAPID_PRIVATE_KEY!);
  return configured;
}

export type PushMessage = { title: string; body?: string | null; href?: string | null; tag?: string };

/** Send to every paired device of one user. Expired subscriptions (404/410) are removed. Returns devices reached. */
export async function sendPush(userId: string, msg: PushMessage): Promise<number> {
  const subs = await db().select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
  if (!subs.length) return 0;
  const payload = JSON.stringify({
    title: msg.title.slice(0, 120),
    body: (msg.body ?? "").slice(0, 300),
    // Only same-site paths: a push can never open another site.
    href: msg.href && msg.href.startsWith("/") && !msg.href.startsWith("//") ? msg.href : "/",
    tag: msg.tag,
  });
  const dead: string[] = [];
  let ok = 0;
  const { title, body, href, tag } = JSON.parse(payload) as { title: string; body: string; href: string; tag?: string };
  await Promise.all(
    subs.map(async (s) => {
      // Firebase Cloud Messaging devices are stored with an "fcm:" endpoint.
      if (s.endpoint.startsWith("fcm:")) {
        const r = await sendFcm(s.endpoint.slice(4), { title, body, href, tag });
        if (r === "ok") ok++;
        else if (r === "dead") dead.push(s.id);
        return;
      }
      if (!pushConfigured()) return;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 12, urgency: "normal" });
        ok++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
        else log.warn("push.failed", { status: code, error: errMessage(err) });
      }
    }),
  );
  if (dead.length) await db().delete(schema.pushSubscriptions).where(inArray(schema.pushSubscriptions.id, dead));
  if (ok) await db().update(schema.pushSubscriptions).set({ lastUsedAt: new Date() }).where(eq(schema.pushSubscriptions.userId, userId));
  return ok;
}
