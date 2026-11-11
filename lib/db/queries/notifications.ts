import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isAdmin } from "@/lib/auth/policy";
import { mailConfigured, topicUnsubscribeUrl, trySendMail } from "@/lib/email/send";
import { appLink, notificationEmail } from "@/lib/email/templates";
import { appUrl, env } from "@/lib/env";
import { sendPush } from "@/lib/push";
import { rateLimit } from "@/lib/security/ratelimit";
import { errMessage, log } from "@/lib/log";
import { inQuietHours, localTime } from "@/lib/time";
import { getSettings } from "./settings";

/** Telegram delivery: notification-only, to the ADMIN's own chat. Never used for other accounts. */
async function sendTelegram(text: string) {
  const e = env();
  if (!e.TELEGRAM_BOT_TOKEN || !e.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: e.TELEGRAM_CHAT_ID, text: text.slice(0, 3500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    log.warn("telegram.failed", { error: errMessage(err) });
  }
}

/** Kinds worth an email. Briefings have their own digest email. */
// Not "urgent_email": emailing someone about an email they already have is noise (and could loop).
const EMAIL_KINDS = new Set(["automation", "automation_failed", "reminder", "post_reminder"]);

/**
 * Create an in-app notification (deduplicated), then deliver it by email to the
 * account's own address (if on), to paired devices by push, and by Telegram (admins only; the bot has one chat).
 */
export async function notify(userId: string, n: { kind: string; title: string; body?: string; href?: string; dedupeKey?: string }) {
  const rows = await db()
    .insert(schema.notifications)
    .values({ userId, kind: n.kind, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null, href: n.href ?? null, dedupeKey: n.dedupeKey ?? null })
    .onConflictDoNothing()
    .returning({ id: schema.notifications.id });
  if (!rows.length) return false;
  const [s, user] = await Promise.all([getSettings(userId), db().query.users.findFirst({ where: eq(schema.users.id, userId), columns: { email: true } })]);
  if (!user || inQuietHours(localTime(s.timezone), s.quietHoursStart, s.quietHoursEnd)) return true;
  if (s.notifyPush) {
    await sendPush(userId, { title: n.title, body: n.body, href: n.href, tag: n.kind }).catch(() => 0);
  }
  if (s.notifyTelegram && isAdmin(user.email)) {
    await sendTelegram(`${n.title}${n.body ? `\n${n.body}` : ""}`);
  }
  if (s.notifyEmail && EMAIL_KINDS.has(n.kind) && mailConfigured() && (await rateLimit("notifyEmail", userId)).success) {
    const base = appUrl();
    await trySendMail(
      user.email,
      notificationEmail({
        kind: n.kind,
        title: n.title.slice(0, 200),
        body: n.body?.slice(0, 500),
        url: appLink(base, n.href),
        manageUrl: `${base}/settings/notifications`,
        unsubscribeUrl: topicUnsubscribeUrl(userId, "updates"),
      }),
      { unsubscribe: { userId, topic: "updates" }, tag: n.kind },
    );
  }
  return true;
}

export async function listNotifications(userId: string, limit = 20) {
  const items = await db()
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit);
  const [row] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return { items, unread: row?.n ?? 0 };
}

/** Mark one of the owner's notifications read (a tap on it in the app). */
export async function markRead(userId: string, id: string) {
  await db()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.id, id), isNull(schema.notifications.readAt)));
}

export async function markAllRead(userId: string) {
  await db()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
}

export { sendTelegram };
