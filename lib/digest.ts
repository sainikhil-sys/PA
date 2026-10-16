import "server-only";
import { Resend } from "resend";
import type { BriefingContent } from "@/lib/db/schema";
import { appUrl, env } from "@/lib/env";
import { errMessage, log } from "@/lib/log";

/** Daily briefing digest, emailed ONLY to the owner's own address (a notification, not outreach). */
export async function sendBriefingDigest(to: string, date: string, b: BriefingContent) {
  const e = env();
  if (!e.RESEND_API_KEY) return;
  const lines = [
    b.headline,
    "",
    b.summary,
    "",
    ...(b.priorities.length ? ["Priorities:", ...b.priorities.map((p) => `• ${p}`), ""] : []),
    ...(b.meetings.length ? ["Meetings:", ...b.meetings.map((m) => `• ${m.start.slice(11, 16) || "All day"} ${m.title}`), ""] : []),
    `Open PA: ${appUrl()}`,
  ];
  try {
    await new Resend(e.RESEND_API_KEY).emails.send({ from: e.MAIL_FROM ?? "PA <onboarding@resend.dev>", to, subject: `Your briefing for ${date}`, text: lines.join("\n") });
  } catch (err) {
    log.warn("digest.failed", { error: errMessage(err) });
  }
}
