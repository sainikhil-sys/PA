import "server-only";
import type { BriefingContent } from "@/lib/db/schema";
import { mailConfigured, topicUnsubscribeUrl, trySendMail } from "@/lib/email/send";
import { digestEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/env";

/** Daily briefing digest, emailed ONLY to the account's own address (a notification, not outreach). */
export async function sendBriefingDigest(user: { id: string; email: string }, date: string, b: BriefingContent) {
  if (!mailConfigured()) return;
  const base = appUrl();
  await trySendMail(
    user.email,
    digestEmail({ date, b, appUrl: base, manageUrl: `${base}/settings/notifications`, unsubscribeUrl: topicUnsubscribeUrl(user.id, "digest") }),
    { unsubscribe: { userId: user.id, topic: "digest" }, tag: "digest" },
  );
}
