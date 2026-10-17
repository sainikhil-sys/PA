"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { NoProviderError } from "@/lib/ai/router";
import { draftPostFromIdea, suggestDailyIdeas } from "@/lib/content/ideas";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { sha256 } from "@/lib/security/crypto";
import { publishToLinkedIn } from "@/lib/integrations/linkedin";

const uuid = z.string().uuid();

function friendly(err: unknown): never {
  if (err instanceof NoProviderError) throw new UserFacingError("Connect an AI provider in Settings > Agent to generate drafts.");
  throw err;
}

export const createIdeaFromNews = ownerAction(z.object({ newsId: uuid }), async ({ newsId }, user) => {
  const n = await db().query.newsItems.findFirst({ where: and(eq(schema.newsItems.id, newsId), eq(schema.newsItems.userId, user.id)) });
  if (!n) throw new UserFacingError("That story is no longer available.");
  await db().insert(schema.ideas).values({ userId: user.id, title: n.title, body: n.summary, source: "news", sourceRef: n.url });
  revalidatePath("/content");
});

export const createIdea = ownerAction(z.object({ title: z.string().trim().min(3).max(200), body: z.string().max(4000).optional() }), async (input, user) => {
  await db().insert(schema.ideas).values({ userId: user.id, title: input.title, body: input.body ?? "", source: "manual" });
  revalidatePath("/content");
});

export const dismissIdea = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  await db().update(schema.ideas).set({ status: "dismissed" }).where(and(eq(schema.ideas.id, id), eq(schema.ideas.userId, user.id)));
  revalidatePath("/content");
  revalidatePath("/");
});

export const refreshIdeas = ownerAction(z.object({}), async (_i, user) => {
  await suggestDailyIdeas(user, { force: true }).catch(friendly);
  revalidatePath("/");
  revalidatePath("/content");
});

export const draftFromIdea = ownerAction(z.object({ ideaId: uuid }), async ({ ideaId }, user) => {
  const draft = await draftPostFromIdea(user, ideaId).catch(friendly);
  revalidatePath("/content");
  return { id: draft.id };
});

/** Any edit clears approval: only the exact approved text can ever be scheduled. */
export const saveDraft = ownerAction(z.object({ id: uuid, title: z.string().trim().min(1).max(200), body: z.string().max(10_000) }), async (input, user) => {
  const current = await db().query.contentDrafts.findFirst({ where: and(eq(schema.contentDrafts.id, input.id), eq(schema.contentDrafts.userId, user.id)) });
  if (!current) throw new UserFacingError("Draft not found.");
  const changed = current.body !== input.body;
  await db()
    .update(schema.contentDrafts)
    .set({ title: input.title, body: input.body, ...(changed ? { approvedHash: null, status: "draft", scheduledFor: null } : {}) })
    .where(eq(schema.contentDrafts.id, input.id));
  revalidatePath(`/content/${input.id}`);
  return { approvalReset: changed && Boolean(current.approvedHash) };
});

export const approveDraft = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  const d = await db().query.contentDrafts.findFirst({ where: and(eq(schema.contentDrafts.id, id), eq(schema.contentDrafts.userId, user.id)) });
  if (!d) throw new UserFacingError("Draft not found.");
  await db().update(schema.contentDrafts).set({ status: "approved", approvedHash: sha256(d.body) }).where(eq(schema.contentDrafts.id, id));
  await logActivity({ userId: user.id, actor: "me", tool: "content.approved", inputSummary: `draft=${id}`, outcome: "success" });
  revalidatePath(`/content/${id}`);
  revalidatePath("/content");
});

export const scheduleDraft = ownerAction(z.object({ id: uuid, at: z.string().datetime().nullable() }), async ({ id, at }, user) => {
  const d = await db().query.contentDrafts.findFirst({ where: and(eq(schema.contentDrafts.id, id), eq(schema.contentDrafts.userId, user.id)) });
  if (!d) throw new UserFacingError("Draft not found.");
  if (at && (!d.approvedHash || d.approvedHash !== sha256(d.body))) throw new UserFacingError("Approve this exact version before scheduling.");
  await db().update(schema.contentDrafts).set({ scheduledFor: at ? new Date(at) : null, status: at ? "scheduled" : "approved" }).where(eq(schema.contentDrafts.id, id));
  revalidatePath("/content");
});

/**
 * Explicit, per-click publishing. Only the exact approved text can go out;
 * any edit since approval blocks it. Never called by agents or automations.
 */
export const publishDraftToLinkedIn = ownerAction(z.object({ id: uuid, confirm: z.literal(true) }), async ({ id }, user) => {
  const d = await db().query.contentDrafts.findFirst({ where: and(eq(schema.contentDrafts.id, id), eq(schema.contentDrafts.userId, user.id)) });
  if (!d) throw new UserFacingError("Draft not found.");
  if (d.status === "published") throw new UserFacingError("This post was already published.");
  if (!d.approvedHash || d.approvedHash !== sha256(d.body)) throw new UserFacingError("Approve this exact version before publishing.");
  if (d.body.length > 3000) throw new UserFacingError("LinkedIn posts are limited to 3,000 characters.");
  let result;
  try {
    result = await publishToLinkedIn(user.id, d.body);
  } catch (err) {
    await logActivity({ userId: user.id, actor: "me", tool: "content.publish_failed", inputSummary: `draft=${id}`, outcome: "error", detail: err instanceof Error ? err.message : "error" });
    throw new UserFacingError(err instanceof Error ? err.message.slice(0, 200) : "Publishing failed.");
  }
  await db().update(schema.contentDrafts).set({ status: "published" }).where(eq(schema.contentDrafts.id, id));
  await logActivity({ userId: user.id, actor: "me", tool: "content.published_linkedin", inputSummary: `draft=${id}`, outcome: "success", detail: result.urn });
  revalidatePath("/content");
  revalidatePath(`/content/${id}`);
  return result;
});

export const markPublished = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  // Publishing itself is manual (copy + open LinkedIn). This only records that I did it.
  await db().update(schema.contentDrafts).set({ status: "published" }).where(and(eq(schema.contentDrafts.id, id), eq(schema.contentDrafts.userId, user.id)));
  await logActivity({ userId: user.id, actor: "me", tool: "content.published_manually", inputSummary: `draft=${id}`, outcome: "success" });
  revalidatePath("/content");
});
