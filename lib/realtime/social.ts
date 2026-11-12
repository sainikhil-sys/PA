import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { after } from "next/server";
import { db, schema } from "@/lib/db";
import { errMessage, log } from "@/lib/log";
import { publishTo, type RealtimeEvent } from "./publish";
import { realtimeConfig } from "./token";

/**
 * Live hints for Chats, sent after the response so a slow or failing Realtime never delays or
 * fails the request. Each one is a nudge to refetch; the app's polling still covers anything missed.
 */
function later(run: () => Promise<void>) {
  if (!realtimeConfig()) return;
  after(async () => {
    try {
      await run();
    } catch (err) {
      log.warn("realtime.social_failed", { error: errMessage(err) });
    }
  });
}

/** People in a chat now; with `includeLeft`, also those who left or were removed (they need to see that). */
async function threadMembers(threadId: string, includeLeft = false): Promise<string[]> {
  const m = schema.dmMembers;
  const rows = await db()
    .select({ userId: m.userId })
    .from(m)
    .where(includeLeft ? eq(m.threadId, threadId) : and(eq(m.threadId, threadId), isNull(m.leftAt)));
  return rows.map((r) => r.userId);
}

async function threadOfMessage(messageId: string): Promise<string | null> {
  const [row] = await db().select({ threadId: schema.dmMessages.threadId }).from(schema.dmMessages).where(eq(schema.dmMessages.id, messageId)).limit(1);
  return row?.threadId ?? null;
}

/** To everyone in the chat (optionally not the person who caused it). */
export function liveThread(threadId: string, e: RealtimeEvent, opts: { except?: string; includeLeft?: boolean } = {}) {
  later(async () => {
    const ids = (await threadMembers(threadId, opts.includeLeft)).filter((id) => id !== opts.except);
    await publishTo(ids, e);
  });
}

/** A message was edited, deleted or reacted to: its chat changed. */
export function liveMessageChanged(messageId: string) {
  later(async () => {
    const threadId = await threadOfMessage(messageId);
    if (threadId) await publishTo(await threadMembers(threadId), { event: "dm.updated", payload: { threadId } });
  });
}

/** Friend requests, accepts, removals and blocks: both people's lists change. */
export function liveFriends(...userIds: string[]) {
  later(() => publishTo(userIds, { event: "friends.changed", payload: {} }));
}
