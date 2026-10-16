import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { enqueue } from "@/lib/jobs/queue";
import { errMessage } from "@/lib/log";
import { Trace } from "@/lib/trace";
import { ADAPTERS } from "./adapters";
import { refreshSourceCount } from "./ingest";

/** Run one incremental batch for a source; re-enqueue itself while more remain. */
export async function syncKnowledgeSource(userId: string, sourceId: string) {
  const source = await db().query.knowledgeSources.findFirst({ where: and(eq(schema.knowledgeSources.id, sourceId), eq(schema.knowledgeSources.userId, userId)) });
  if (!source || !source.included) return;
  const adapter = ADAPTERS[source.type];
  if (!adapter) return;
  const trace = new Trace(userId, "job", "schedule");
  await db().update(schema.knowledgeSources).set({ status: "syncing" }).where(eq(schema.knowledgeSources.id, source.id));
  try {
    const res = await trace.span(`source:${source.type}`, `Syncing ${source.name}`, () => adapter(source), (r) => ({ label: `Synced ${r.processed} items from ${source.name}`, meta: { count: r.processed } }));
    await db()
      .update(schema.knowledgeSources)
      .set({ status: "idle", cursor: res.cursor, lastSyncAt: new Date(), lastError: null })
      .where(eq(schema.knowledgeSources.id, source.id));
    await refreshSourceCount(source.id);
    if (!res.done) await enqueue(userId, "knowledge_sync", { sourceId }, { dedupeKey: `ksync:${sourceId}:more:${Date.now()}` });
    if (res.processed) await logActivity({ userId, actor: "agent", tool: "knowledge.sync", inputSummary: `${source.type}: ${res.processed} items`, outcome: "success" });
  } catch (err) {
    const message = errMessage(err).slice(0, 200);
    await db().update(schema.knowledgeSources).set({ status: "error", lastError: message }).where(eq(schema.knowledgeSources.id, source.id));
    await logActivity({ userId, actor: "agent", tool: "knowledge.sync", inputSummary: source.type, outcome: "error", detail: message });
    throw err;
  }
}
