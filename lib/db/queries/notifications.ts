import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { errMessage, log } from "@/lib/log";
import { inQuietHours, localTime } from "@/lib/time";
import { getSettings } from "./settings";

/** Telegram delivery: notification-only, to the owner's own chat. Never used to message anyone else. */
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

/** Create an in-app notification (deduplicated) and optionally mirror it to Telegram. */
export async function notify(userId: string, n: { kind: string; title: string; body?: string; href?: string; dedupeKey?: string }) {
  const rows = await db()
    .insert(schema.notifications)
    .values({ userId, kind: n.kind, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null, href: n.href ?? null, dedupeKey: n.dedupeKey ?? null })
    .onConflictDoNothing()
    .returning({ id: schema.notifications.id });
  if (!rows.length) return false;
  const s = await getSettings(userId);
  if (s.notifyTelegram && !inQuietHours(localTime(s.timezone), s.quietHoursStart, s.quietHoursEnd)) {
    await sendTelegram(`${n.title}${n.body ? `\n${n.body}` : ""}`);
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

export async function markAllRead(userId: string) {
  await db()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
}

export { sendTelegram };
