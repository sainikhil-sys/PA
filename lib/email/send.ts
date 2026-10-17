import "server-only";
import { Resend } from "resend";
import { BRAND } from "@/lib/brand";
import { appUrl, env, isTestMode, requireEnv } from "@/lib/env";
import { errMessage, log } from "@/lib/log";
import type { Email } from "./templates";
import { unsubscribeUrl, type EmailTopic } from "./unsubscribe";

let client: Resend | undefined;

export function mailConfigured(): boolean {
  return Boolean(env().RESEND_API_KEY);
}

export function mailFrom(): string {
  return env().MAIL_FROM ?? `${BRAND.name} <onboarding@resend.dev>`;
}

/** Signed one-click unsubscribe link for a topic (no session needed). */
export function topicUnsubscribeUrl(userId: string, topic: EmailTopic): string {
  return unsubscribeUrl(appUrl(), userId, topic, requireEnv("AUTH_SECRET"));
}

/**
 * Sends one email to ONE recipient: the account's own address. Throws on
 * delivery failure so callers decide whether that matters (OTP) or not (updates).
 */
export async function sendMail(to: string, email: Email, opts: { unsubscribe?: { userId: string; topic: EmailTopic }; tag?: string } = {}) {
  const e = env();
  if (isTestMode()) return;
  if (!e.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  client ??= new Resend(e.RESEND_API_KEY);
  const headers: Record<string, string> = {};
  if (opts.unsubscribe) {
    // RFC 8058 one-click unsubscribe (Gmail/Yahoo bulk-sender requirement).
    headers["List-Unsubscribe"] = `<${topicUnsubscribeUrl(opts.unsubscribe.userId, opts.unsubscribe.topic)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const { error } = await client.emails.send({
    from: mailFrom(),
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers,
    ...(opts.tag ? { tags: [{ name: "type", value: opts.tag }] } : {}),
  });
  if (error) throw new Error(`${error.name}: ${error.message}`);
}

/** Best-effort send for updates: logs and swallows failures. */
export async function trySendMail(to: string, email: Email, opts: Parameters<typeof sendMail>[2] = {}): Promise<boolean> {
  try {
    await sendMail(to, email, opts);
    return true;
  } catch (err) {
    log.warn("mail.failed", { tag: opts.tag, error: errMessage(err) });
    return false;
  }
}
