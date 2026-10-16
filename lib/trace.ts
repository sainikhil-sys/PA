import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { log } from "@/lib/log";

export type SpanStatus = "running" | "ok" | "error" | "blocked" | "waiting" | "dry_run";
type Meta = Record<string, string | number | boolean | null>;

/**
 * Lightweight run tracing. Every agent run (chat, voice, automation, MCP call,
 * background job) records spans: which node did what, with counts only.
 * Tracing must never break the run, so all writes swallow errors.
 */
export class Trace {
  readonly runId: string;
  constructor(
    readonly userId: string,
    readonly runKind: "chat" | "voice" | "automation" | "mcp" | "job",
    readonly trigger: string,
    runId?: string,
  ) {
    this.runId = runId ?? randomUUID();
  }

  async span<T>(node: string, label: string, fn: () => Promise<T>, describe?: (result: T) => { label?: string; meta?: Meta; status?: SpanStatus }): Promise<T> {
    const id = await this.start(node, label);
    try {
      const result = await fn();
      const d = describe?.(result);
      await this.end(id, d?.status ?? "ok", d?.label, d?.meta);
      return result;
    } catch (err) {
      await this.end(id, "error", `${label} failed`);
      throw err;
    }
  }

  async start(node: string, label: string, meta: Meta = {}): Promise<string | null> {
    try {
      const [row] = await db()
        .insert(schema.traceSpans)
        .values({ userId: this.userId, runId: this.runId, runKind: this.runKind, trigger: this.trigger, node, label: label.slice(0, 200), meta })
        .returning({ id: schema.traceSpans.id });
      return row?.id ?? null;
    } catch {
      log.warn("trace.write_failed", { node });
      return null;
    }
  }

  async end(id: string | null, status: SpanStatus, label?: string, meta?: Meta) {
    if (!id) return;
    try {
      await db()
        .update(schema.traceSpans)
        .set({ status, endedAt: new Date(), ...(label ? { label: label.slice(0, 200) } : {}), ...(meta ? { meta } : {}) })
        .where(eq(schema.traceSpans.id, id));
    } catch {
      log.warn("trace.write_failed", { status });
    }
  }

  /** Record an instantaneous step. */
  async event(node: string, label: string, status: SpanStatus = "ok", meta: Meta = {}) {
    const id = await this.start(node, label, meta);
    await this.end(id, status);
  }
}

/** Spans newer than a cursor (ISO timestamp), oldest first. */
export async function spansSince(userId: string, since: Date, limit = 100) {
  return db()
    .select()
    .from(schema.traceSpans)
    .where(and(eq(schema.traceSpans.userId, userId), gt(schema.traceSpans.startedAt, since)))
    .orderBy(asc(schema.traceSpans.startedAt))
    .limit(limit);
}

export async function runSpans(userId: string, runId: string) {
  return db()
    .select()
    .from(schema.traceSpans)
    .where(and(eq(schema.traceSpans.userId, userId), eq(schema.traceSpans.runId, runId)))
    .orderBy(asc(schema.traceSpans.startedAt));
}

export async function recentSpans(userId: string, limit = 20) {
  return db().select().from(schema.traceSpans).where(eq(schema.traceSpans.userId, userId)).orderBy(desc(schema.traceSpans.startedAt)).limit(limit);
}
