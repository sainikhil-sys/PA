import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { generate, generateObject } from "@/lib/ai/router";
import { renderPrompt, UNTRUSTED_CONTENT_RULES } from "@/lib/ai/prompts";
import { db, schema } from "@/lib/db";
import type { Email, User } from "@/lib/db/schema";
import { createReplyDraft, getMessageBody, getMessageMeta } from "@/lib/integrations/gmail";
import { stripInvisible, wrapEmailContent } from "@/lib/security/sanitize";
import { emailClassificationSchema } from "./schemas";

/**
 * Email agent. Emails are UNTRUSTED input: they are wrapped in <email_content>
 * tags and the model gets no tools. It only returns a validated JSON object
 * (classification) or plain text (a draft that is saved as a Gmail DRAFT for review).
 */

const CLASSIFY_SYSTEM = `You are an email triage classifier. You output only JSON.\n\n${UNTRUSTED_CONTENT_RULES}`;
const DRAFT_SYSTEM = `You write reply drafts for human review. Output only the reply text.\n\n${UNTRUSTED_CONTENT_RULES}`;

export async function classifyEmail(userId: string, email: Email) {
  // Count the attempt first so a poisoned email cannot be retried forever.
  await db()
    .update(schema.emails)
    .set({ classifyAttempts: sql`${schema.emails.classifyAttempts} + 1` })
    .where(eq(schema.emails.id, email.id));

  let body = "";
  try {
    body = await getMessageBody(userId, email.gmailId);
  } catch {
    body = email.snippet; // fall back to Gmail's snippet
  }
  const prompt = renderPrompt("classify-email", {
    email: wrapEmailContent({
      from: [email.fromName, email.fromEmail].filter(Boolean).join(" "),
      subject: email.subject,
      date: email.receivedAt.toISOString(),
      body,
    }),
  });
  const { value, model } = await generateObject({
    kind: "classify_email",
    userId,
    tier: "fast",
    system: CLASSIFY_SYSTEM,
    prompt,
    schema: emailClassificationSchema,
  });
  await db()
    .update(schema.emails)
    .set({
      category: value.category,
      summary: stripInvisible(value.summary),
      priority: value.priority,
      actionRequired: value.action_required,
      classifiedAt: new Date(),
    })
    .where(and(eq(schema.emails.id, email.id), eq(schema.emails.userId, userId)));
  return { ...value, model };
}

/** Generate a reply and store it as a Gmail DRAFT. Nothing is ever sent. */
export async function draftReply(user: User, email: Email, instructions?: string) {
  if (!email.fromEmail) throw new Error("This email has no sender address to reply to.");
  const [body, meta] = await Promise.all([getMessageBody(user.id, email.gmailId), getMessageMeta(user.id, email.gmailId)]);
  const firstName = user.name?.split(" ")[0] ?? "";
  const prompt = renderPrompt("draft-reply", {
    owner_name: user.name ?? "the owner",
    sign_off: firstName ? `Best,\n${firstName}` : "Best,",
    instructions: instructions ? `Owner's instructions for this reply (trusted): ${instructions.slice(0, 500)}` : "",
    email: wrapEmailContent({
      from: [email.fromName, email.fromEmail].filter(Boolean).join(" "),
      subject: email.subject,
      date: email.receivedAt.toISOString(),
      body,
    }),
  });
  const { value: text, model } = await generate({
    kind: "draft_reply",
    userId: user.id,
    tier: "smart",
    system: DRAFT_SYSTEM,
    prompt,
    temperature: 0.5,
  });
  const draftText = stripInvisible(text).trim();
  if (!draftText) throw new Error("Cowork couldn't write a draft this time. Try again.");

  const draftId = await createReplyDraft(user.id, {
    threadId: email.threadId,
    to: email.fromEmail,
    subject: email.subject,
    body: draftText,
    inReplyTo: meta.messageIdHeader,
    references: meta.references,
  });
  await db()
    .update(schema.emails)
    .set({ draftId, draftCreatedAt: new Date() })
    .where(and(eq(schema.emails.id, email.id), eq(schema.emails.userId, user.id)));
  return { draftId, model };
}
