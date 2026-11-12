import "server-only";
import { sql } from "drizzle-orm";
import { db, rowsOf, schema, type DB } from "@/lib/db";
import { redactForAudit } from "./core";

export type AuditExecutor = Pick<DB, "insert" | "execute">;

export type AuditEntry = {
  actorUserId: string | null;
  actorEmailHash?: string | null;
  actorRole?: string | null;
  adminSessionId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  outcome: "success" | "denied" | "failed";
  ipPrefix?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

/**
 * Appends one audit row. Pass the transaction that made the change so both commit or neither does.
 * before and after are redacted here; the database trigger sets the hash chain.
 */
export async function writeAudit(entry: AuditEntry, executor: AuditExecutor = db()): Promise<void> {
  await executor.insert(schema.adminAuditLogs).values({
    actorUserId: entry.actorUserId,
    actorEmailHash: entry.actorEmailHash ?? null,
    actorRole: entry.actorRole ?? null,
    adminSessionId: entry.adminSessionId ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    before: entry.before === undefined ? null : redactForAudit(entry.before),
    after: entry.after === undefined ? null : redactForAudit(entry.after),
    reason: entry.reason?.slice(0, 1000) ?? null,
    outcome: entry.outcome,
    ipPrefix: entry.ipPrefix ?? null,
    userAgent: entry.userAgent?.slice(0, 300) ?? null,
    requestId: entry.requestId ?? null,
  });
}

/** Recomputes the hash chain in the database. Returns the first broken row, if any. */
export async function verifyAuditChain(): Promise<{ ok: boolean; rows: number; firstBrokenSeq: number | null }> {
  const [r] = rowsOf<{ rows: string; broken: string | null }>(
    await db().execute(sql`
      select count(*)::text as rows, min(seq) filter (where not ok)::text as broken from (
        select seq, hash = admin_audit_row_hash(lag(hash) over (order by seq), l)
          and prev_hash is not distinct from lag(hash) over (order by seq) as ok
        from admin_audit_logs l
      ) x`),
  );
  const broken = r?.broken ? Number(r.broken) : null;
  return { ok: broken === null, rows: Number(r?.rows ?? 0), firstBrokenSeq: broken };
}
