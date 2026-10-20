import "server-only";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { renderBroadcastEmail } from "@/lib/email/broadcast";
import { mailConfigured, topicUnsubscribeUrl, trySendMail } from "@/lib/email/send";
import { appLink, notificationEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/env";
import { errMessage, log } from "@/lib/log";
import { sendPush } from "@/lib/push";
import { filesForBroadcast, mailParts } from "./broadcast-files";

export type BroadcastChannel = "in_app" | "push" | "email";
const BATCH = 40;

/**
 * Deliver a broadcast to every active account, in batches, resumable via `cursor`.
 * Respects each person's choices: push only if they keep push on, email only if
 * email updates are on (the same "updates" unsubscribe link applies).
 * Returns true when finished.
 */
export async function processBroadcast(id: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  const [b] = await db().select().from(schema.broadcasts).where(eq(schema.broadcasts.id, id)).limit(1);
  if (!b || b.status === "sent" || b.status === "cancelled") return true;
  if (b.status === "queued") await db().update(schema.broadcasts).set({ status: "sending" }).where(eq(schema.broadcasts.id, id));
  const channels = new Set(b.channels as BroadcastChannel[]);
  const base = appUrl();
  const manageUrl = `${base}/settings/notifications`;
  // A designed email carries its images (inline, cid:) and attachments; loaded once per run.
  const designed = channels.has("email") && b.email ? b.email : null;
  const parts = designed ? mailParts(await filesForBroadcast(b.id)) : null;
  let cursor = b.cursor;

  while (Date.now() < deadline - 5_000) {
    const users = await db()
      .select({ id: schema.users.id, email: schema.users.email, notifyPush: schema.userSettings.notifyPush, notifyEmail: schema.userSettings.notifyEmail })
      .from(schema.users)
      .leftJoin(schema.userSettings, eq(schema.userSettings.userId, schema.users.id))
      .where(and(isNull(schema.users.disabledAt), cursor ? gt(schema.users.id, cursor) : undefined))
      .orderBy(asc(schema.users.id))
      .limit(BATCH);
    if (!users.length) {
      await db().update(schema.broadcasts).set({ status: "sent", finishedAt: new Date(), cursor }).where(eq(schema.broadcasts.id, id));
      return true;
    }
    let inApp = 0;
    let push = 0;
    let email = 0;
    if (channels.has("in_app")) {
      const rows = await db()
        .insert(schema.notifications)
        .values(users.map((u) => ({ userId: u.id, kind: "announcement", title: b.title.slice(0, 200), body: b.body.slice(0, 500), href: b.href, dedupeKey: `broadcast:${b.id}` })))
        .onConflictDoNothing()
        .returning({ id: schema.notifications.id });
      inApp = rows.length;
    }
    for (const u of users) {
      try {
        if (channels.has("push") && u.notifyPush !== false) push += (await sendPush(u.id, { title: b.title, body: b.body, href: b.href, tag: `broadcast:${b.id}` })) > 0 ? 1 : 0;
        if (channels.has("email") && u.notifyEmail !== false && mailConfigured()) {
          const unsubscribeUrl = topicUnsubscribeUrl(u.id, "updates");
          const mail =
            designed && parts
              ? renderBroadcastEmail(designed, { appBase: base, imageSrc: parts.imageSrc, images: parts.images, attachments: parts.attachedList, manageUrl, unsubscribeUrl })
              : notificationEmail({ kind: "announcement", title: b.title, body: b.body, url: appLink(base, b.href), manageUrl, unsubscribeUrl });
          const sent = await trySendMail(u.email, mail, { unsubscribe: { userId: u.id, topic: "updates" }, tag: "announcement", attachments: parts?.attachments });
          if (sent) email++;
          await new Promise((r) => setTimeout(r, 550)); // stay under the mail provider's per-second limit
        }
      } catch (err) {
        log.warn("broadcast.user_failed", { error: errMessage(err) });
      }
    }
    cursor = users[users.length - 1]!.id;
    await db()
      .update(schema.broadcasts)
      .set({
        cursor,
        sentInApp: sql`${schema.broadcasts.sentInApp} + ${inApp}`,
        sentPush: sql`${schema.broadcasts.sentPush} + ${push}`,
        sentEmail: sql`${schema.broadcasts.sentEmail} + ${email}`,
      })
      .where(eq(schema.broadcasts.id, id));
  }
  return false;
}

/** Broadcasts still in progress (for the dispatcher to resume). */
export async function unfinishedBroadcasts() {
  return db().select({ id: schema.broadcasts.id }).from(schema.broadcasts).where(inArray(schema.broadcasts.status, ["queued", "sending"]));
}
