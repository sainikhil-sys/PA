import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/security/crypto";

/** Email streams a user can switch off from a link in the email itself. */
export const EMAIL_TOPICS = ["updates", "digest"] as const;
export type EmailTopic = (typeof EMAIL_TOPICS)[number];

/** Signed, non-expiring token: proves the link came from us without a session. */
export function unsubscribeToken(userId: string, topic: EmailTopic, secret: string): string {
  return createHmac("sha256", secret).update(`unsub:${userId}:${topic}`).digest("base64url");
}

export function verifyUnsubscribeToken(userId: string, topic: string, token: string, secret: string): topic is EmailTopic {
  if (!(EMAIL_TOPICS as readonly string[]).includes(topic) || !/^[0-9a-f-]{36}$/i.test(userId)) return false;
  return safeEqual(unsubscribeToken(userId, topic as EmailTopic, secret), token);
}

export function unsubscribeUrl(base: string, userId: string, topic: EmailTopic, secret: string): string {
  const q = new URLSearchParams({ u: userId, k: topic, t: unsubscribeToken(userId, topic, secret) });
  return `${base}/api/email/unsubscribe?${q}`;
}
