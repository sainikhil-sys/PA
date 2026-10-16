import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Actor } from "@/lib/db/schema";
import { log } from "@/lib/log";

export async function logActivity(entry: {
  userId: string;
  actor: Actor;
  tool: string;
  inputSummary?: string;
  outcome: "success" | "error" | "denied";
  detail?: string | null;
  tokenId?: string | null;
}) {
  try {
    await db()
      .insert(schema.activityLog)
      .values({
        ...entry,
        inputSummary: (entry.inputSummary ?? "").slice(0, 300),
        detail: entry.detail?.slice(0, 300) ?? null,
      });
  } catch {
    log.error("activity.write_failed", { tool: entry.tool });
  }
}

export async function listActivity(userId: string, opts: { limit?: number; actor?: Actor; before?: Date } = {}) {
  const conds = [eq(schema.activityLog.userId, userId)];
  if (opts.actor) conds.push(eq(schema.activityLog.actor, opts.actor));
  if (opts.before) conds.push(lt(schema.activityLog.createdAt, opts.before));
  return db()
    .select()
    .from(schema.activityLog)
    .where(and(...conds))
    .orderBy(desc(schema.activityLog.createdAt))
    .limit(Math.min(opts.limit ?? 30, 100));
}
