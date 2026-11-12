"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { processBroadcast } from "@/lib/admin/broadcast";
import type { Permission } from "@/lib/admin/permissions";
import { hasPermission } from "@/lib/admin/roles";
import { deleteUnsentFile, linkFilesToBroadcast, mailParts, resolveBroadcastFiles, unsentFilesWithData } from "@/lib/admin/broadcast-files";
import { generateObject, NoProviderError, testProvider } from "@/lib/ai/router";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { BRAND } from "@/lib/brand";
import { db, schema } from "@/lib/db";
import type { BroadcastEmailContent, User } from "@/lib/db/schema";
import { logActivity } from "@/lib/db/queries/activity";
import { MAX_ATTACHMENTS } from "@/lib/email/attachments";
import {
  BROADCAST_STYLE_IDS,
  BROADCAST_STYLES,
  cleanEmail,
  draftToEmail,
  EMAIL_LIMITS as L,
  IN_APP_PATHS,
  linkAllowList,
  noDashes,
  plainNotificationText,
  renderBroadcastEmail,
  restrictLinks,
  safeMailUrl,
  type BroadcastStyle,
} from "@/lib/email/broadcast";
import { mailConfigured, sendMail, topicUnsubscribeUrl } from "@/lib/email/send";
import { appUrl } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { errMessage } from "@/lib/log";

const uuid = z.string().uuid();

/** Every admin action re-checks the role and permission server-side; the console UI is not the guard. */
async function assertAdmin(user: User, permission: Permission) {
  if (!(await hasPermission(user, permission))) throw new Error("Not found");
}

export const setUserDisabled = ownerAction(z.object({ userId: z.string().uuid(), disabled: z.boolean() }), async ({ userId, disabled }, user) => {
  await assertAdmin(user, "users.suspend");
  if (userId === user.id) throw new Error("You can't disable your own account");
  await db().update(schema.users).set({ disabledAt: disabled ? new Date() : null }).where(eq(schema.users.id, userId));
  if (disabled) await db().update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
  await logActivity({ userId: user.id, actor: "me", tool: disabled ? "admin.user_disabled" : "admin.user_enabled", inputSummary: userId, outcome: "success" });
  revalidatePath("/console/users");
});

// ---------- Broadcasts ----------

/** What the model returns. Lenient on length (clamped afterwards) so a long draft isn't a failed draft. */
const draftSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(10).max(1000),
  subject: z.string().trim().min(3).max(250),
  preheader: z.string().trim().max(400).default(""),
  headline: z.string().trim().min(3).max(250),
  intro: z.string().trim().max(3000).default(""),
  sections: z
    .array(z.object({ heading: z.string().trim().max(250).nullish(), text: z.string().trim().max(4000).default(""), bullets: z.array(z.string().trim().max(500)).max(12).nullish() }))
    .max(6)
    .default([]),
  cta: z.object({ label: z.string().trim().min(1).max(80), url: z.string().trim().min(1).max(2000) }).nullish(),
  closing: z.string().trim().max(800).default(""),
});

function draftSystem(style: BroadcastStyle): string {
  return [
    `You write the emails and short notifications that the ${BRAND.name} team sends to everyone who uses ${BRAND.name}, an AI work assistant.`,
    `Format: ${BROADCAST_STYLES[style].guide}`,
    "Rules:",
    "- Use only facts from the note. Never invent features, dates, times, numbers, prices, names or links.",
    "- Plain, warm, specific language. No hype, no emoji, no exclamation marks, no em dashes (use commas, colons or periods).",
    `- Links: write them as [label](url), and only with URLs that appear in the note or these app pages: ${IN_APP_PATHS.join(", ")}.`,
    "- The button url follows the same rule. Use null for cta when no link fits.",
    "- Use **bold** sparingly for a key phrase. No other markdown and no HTML.",
    "Output ONLY a JSON object with exactly these keys:",
    '{"title": "notification title, under 70 characters",',
    ' "body": "notification text, 1 to 3 sentences, under 400 characters, no links",',
    ' "subject": "email subject, under 80 characters",',
    ' "preheader": "inbox preview line that adds to the subject, under 110 characters",',
    ' "headline": "email headline, under 80 characters",',
    ' "intro": "opening paragraph",',
    ' "sections": [{"heading": "short heading or null", "text": "paragraph", "bullets": ["item", "item"] or null}],',
    ' "cta": {"label": "2 to 4 words", "url": "an app page or a URL from the note"} or null,',
    ' "closing": "one short closing line"}',
  ].join("\n");
}

/** Turn a rough note into a notification (title + body) and a designed email. The admin edits both before sending. */
export const draftBroadcast = ownerAction(z.object({ prompt: z.string().trim().min(5).max(4000), style: z.enum(BROADCAST_STYLE_IDS) }), async ({ prompt, style }, user) => {
  await assertAdmin(user, "notifications.send");
  const { value } = await generateObject({
    kind: "admin.broadcast_draft",
    userId: user.id,
    tier: "smart",
    temperature: 0.4,
    system: draftSystem(style),
    prompt: `Write it from this note:\n<note>\n${prompt}\n</note>`,
    schema: draftSchema,
  }).catch((err: unknown) => {
    if (err instanceof NoProviderError) throw new UserFacingError("No AI provider is set up on the server.");
    throw err;
  });
  // Our copy never uses em dashes, whatever the model writes.
  const d = {
    ...value,
    title: noDashes(value.title),
    body: noDashes(value.body),
    subject: noDashes(value.subject),
    preheader: noDashes(value.preheader),
    headline: noDashes(value.headline),
    intro: noDashes(value.intro),
    closing: noDashes(value.closing),
    sections: value.sections.map((s) => ({ heading: s.heading ? noDashes(s.heading) : s.heading, text: noDashes(s.text), bullets: s.bullets?.map(noDashes) ?? null })),
    cta: value.cta ? { ...value.cta, label: noDashes(value.cta.label) } : value.cta,
  };
  const email = draftToEmail(d);
  return {
    title: plainNotificationText(d.title).slice(0, 120),
    body: plainNotificationText(d.body).slice(0, 600),
    // Links the model made up (not in the note, not an app page) are removed.
    email: cleanEmail({ ...email, blocks: restrictLinks(email.blocks, linkAllowList(prompt)) }),
  };
});

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text: z.string().trim().min(1).max(L.heading) }),
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(L.text) }),
  z.object({ type: z.literal("list"), items: z.array(z.string().trim().min(1).max(L.listItem)).min(1).max(L.listItems) }),
  z.object({ type: z.literal("button"), label: z.string().trim().min(1).max(L.buttonLabel), url: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("image"), fileId: uuid, alt: z.string().trim().max(L.alt), href: z.string().trim().max(2000).optional() }),
  z.object({ type: z.literal("divider") }),
]);

const emailSchema = z.object({
  subject: z.string().trim().min(3, "Add an email subject").max(L.subject),
  preheader: z.string().trim().max(L.preheader),
  headline: z.string().trim().min(1, "Add an email headline").max(L.headline),
  blocks: z.array(blockSchema).max(L.blocks),
});

/** Buttons and image links must be real, safe links; a bad link in text just stays plain text. */
function checkEmailLinks(email: BroadcastEmailContent, base: string) {
  for (const b of email.blocks) {
    if (b.type === "button" && !safeMailUrl(b.url, base)) throw new UserFacingError(`The "${b.label}" button needs a link that starts with https:// or an app path like /settings.`);
    if (b.type === "image" && b.href && !safeMailUrl(b.href, base)) throw new UserFacingError("An image link isn't valid. Use https://… or an app path like /settings.");
  }
}

export const sendBroadcast = ownerAction(
  z.object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(600),
    href: z
      .string()
      .trim()
      .max(200)
      .regex(/^\/(?!\/)[\w\-/?=&.#]*$/, "Use an in-app path like /settings")
      .optional()
      .or(z.literal("")),
    channels: z.array(z.enum(["in_app", "push", "email"])).min(1),
    email: emailSchema.optional(),
    attachmentIds: z.array(uuid).max(MAX_ATTACHMENTS).default([]),
    confirm: z.literal(true),
  }),
  async (input, user) => {
    await assertAdmin(user, "notifications.send");
    const email = input.channels.includes("email") && input.email ? input.email : null;
    if (email) checkEmailLinks(email, appUrl());
    const files = await resolveBroadcastFiles(user.id, email, email ? input.attachmentIds : []);
    const [b] = await db()
      .insert(schema.broadcasts)
      .values({ createdBy: user.id, title: input.title, body: input.body, href: input.href || null, channels: input.channels, email })
      .returning({ id: schema.broadcasts.id });
    await linkFilesToBroadcast(
      user.id,
      files.map((f) => f.id),
      b!.id,
    );
    await logActivity({
      userId: user.id,
      actor: "me",
      tool: "admin.broadcast_sent",
      inputSummary: `${input.channels.join("+")}: ${input.title.slice(0, 60)}${files.length ? ` (+${files.length} files)` : ""}`,
      outcome: "success",
    });
    // Start right away; the job queue finishes anything that doesn't fit in this request.
    after(async () => {
      const done = await processBroadcast(b!.id, 45_000).catch(() => false);
      if (!done) await enqueue(user.id, "broadcast", { broadcastId: b!.id }, { dedupeKey: `broadcast:${b!.id}:start` });
    });
    revalidatePath("/console/broadcast");
    return { id: b!.id };
  },
);

/** Send the designed email, with its images and attachments, to the admin's own address only. */
export const sendBroadcastTest = ownerAction(z.object({ email: emailSchema, attachmentIds: z.array(uuid).max(MAX_ATTACHMENTS).default([]) }), async (input, user) => {
  await assertAdmin(user, "notifications.send");
  if (!mailConfigured()) throw new UserFacingError("Email isn't set up on the server yet (RESEND_API_KEY is missing).");
  const base = appUrl();
  checkEmailLinks(input.email, base);
  const metas = await resolveBroadcastFiles(user.id, input.email, input.attachmentIds);
  const parts = mailParts(
    await unsentFilesWithData(
      user.id,
      metas.map((m) => m.id),
    ),
  );
  const mail = renderBroadcastEmail(
    { ...input.email, subject: `[Test] ${input.email.subject}` },
    { appBase: base, imageSrc: parts.imageSrc, images: parts.images, attachments: parts.attachedList, manageUrl: `${base}/settings/notifications`, unsubscribeUrl: topicUnsubscribeUrl(user.id, "updates") },
  );
  try {
    await sendMail(user.email, mail, { tag: "announcement_test", attachments: parts.attachments });
  } catch (err) {
    throw new UserFacingError(`The email provider didn't accept it: ${errMessage(err)}`);
  }
  await logActivity({ userId: user.id, actor: "me", tool: "admin.broadcast_test", inputSummary: input.email.subject.slice(0, 80), outcome: "success" });
  return { to: user.email };
});

/** Remove an upload that hasn't been sent. */
export const removeBroadcastFile = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  await assertAdmin(user, "notifications.send");
  await deleteUnsentFile(user.id, id);
});

export const retryDeadJob = ownerAction(z.object({ id: z.string().uuid() }), async ({ id }, user) => {
  await assertAdmin(user, "infra.write");
  await db().update(schema.jobs).set({ status: "pending", attempts: 0, runAt: new Date(), lastError: null }).where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, "failed")));
  revalidatePath("/console/system");
});

export const testServerAi = ownerAction(z.object({ name: z.string().max(40) }), async ({ name }, user) => {
  await assertAdmin(user, "ai.write");
  return testProvider(name);
});
