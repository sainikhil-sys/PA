"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { fetchPageText } from "@/lib/knowledge/extract";
import { addTextToKnowledge, deleteSourceData, ensureSource, refreshSourceCount, upsertItem } from "@/lib/knowledge/ingest";
import { syncKnowledgeSource } from "@/lib/knowledge/sync";
import { sha256 } from "@/lib/security/crypto";

const uuid = z.string().uuid();
const SOURCE_TYPES = ["drive", "gmail", "notion", "slack", "github"] as const;
const NAMES: Record<(typeof SOURCE_TYPES)[number], string> = { drive: "Google Drive", gmail: "Gmail", notion: "Notion", slack: "Slack", github: "GitHub" };

function done() {
  revalidatePath("/knowledge");
}

export const addSource = ownerAction(z.object({ type: z.enum(SOURCE_TYPES), selection: z.string().max(2000) }), async ({ type, selection }, user) => {
  const key = { drive: "folderIds", gmail: "labelIds", notion: "pageIds", slack: "channels", github: "repos" }[type];
  const values = selection.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 25);
  if (type !== "gmail" && type !== "notion" && !values.length) throw new UserFacingError("Choose at least one folder, channel or repo.");
  const source = await ensureSource(user.id, type, NAMES[type]);
  await db().update(schema.knowledgeSources).set({ config: { [key]: values }, cursor: null, included: true }).where(eq(schema.knowledgeSources.id, source.id));
  await logActivity({ userId: user.id, actor: "me", tool: "knowledge.source_added", inputSummary: type, outcome: "success" });
  done();
  return { id: source.id };
});

export const toggleSourceIncluded = ownerAction(z.object({ id: uuid, included: z.boolean() }), async ({ id, included }, user) => {
  await db().update(schema.knowledgeSources).set({ included }).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.userId, user.id)));
  done();
});

export const syncSourceNow = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  try {
    await syncKnowledgeSource(user.id, id);
  } catch (err) {
    throw new UserFacingError(err instanceof Error && /isn't connected|returned|Slack:/.test(err.message) ? err.message : "Sync failed. Check the connection and try again.");
  }
  done();
});

/** Destructive; behind a confirm dialog. Removes synced items & chunks, keeps the source. */
export const deleteSyncedData = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  await deleteSourceData(user.id, id);
  await logActivity({ userId: user.id, actor: "me", tool: "knowledge.data_deleted", inputSummary: `source=${id}`, outcome: "success" });
  done();
});

export const removeSource = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  await db().delete(schema.knowledgeSources).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.userId, user.id)));
  done();
});

export const addPastedText = ownerAction(z.object({ title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(200_000) }), async (input, user) => {
  await addTextToKnowledge(user.id, { ...input, via: "me" });
  done();
});

export const addUrl = ownerAction(z.object({ url: z.string().url().max(2000) }), async ({ url }, user) => {
  let page;
  try {
    page = await fetchPageText(url);
  } catch (err) {
    throw new UserFacingError(err instanceof Error ? err.message : "Couldn't fetch that page.");
  }
  const source = await ensureSource(user.id, "url", "Web pages");
  await upsertItem(source, { externalId: sha256(url).slice(0, 32), title: page.title, url, mimeType: "text/html", text: page.text });
  await refreshSourceCount(source.id);
  done();
});

export const deleteItem = ownerAction(z.object({ id: uuid }), async ({ id }, user) => {
  const item = await db().query.knowledgeItems.findFirst({ where: and(eq(schema.knowledgeItems.id, id), eq(schema.knowledgeItems.userId, user.id)) });
  if (!item) return;
  await db().delete(schema.knowledgeItems).where(eq(schema.knowledgeItems.id, id));
  await refreshSourceCount(item.sourceId);
  done();
});
