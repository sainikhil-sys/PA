import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Table } from "@/components/admin/parts";
import { verifyAuditChain } from "@/lib/admin/audit";
import { requireAdmin } from "@/lib/admin/guard";
import { recoveryCodesLeft } from "@/lib/admin/mfa";
import { db, schema } from "@/lib/db";
import { timeAgo } from "@/lib/utils";

export default async function ConsoleSecurity() {
  const me = await requireAdmin("audit.read");
  const [chain, rows, sessions, codesLeft] = await Promise.all([
    verifyAuditChain().catch(() => null),
    db().select().from(schema.adminAuditLogs).orderBy(desc(schema.adminAuditLogs.seq)).limit(100),
    db()
      .select()
      .from(schema.adminSessions)
      .where(and(eq(schema.adminSessions.userId, me.id), isNull(schema.adminSessions.revokedAt), gt(schema.adminSessions.expiresAt, new Date())))
      .orderBy(desc(schema.adminSessions.createdAt))
      .limit(20),
    recoveryCodesLeft(me.id),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="card rounded-[14px] border border-border bg-background p-3.5">
          <p className="text-[12px] text-muted">Audit trail</p>
          <p className={chain && !chain.ok ? "mt-1 text-[15px] font-medium text-danger" : "mt-1 text-[15px] font-medium"}>
            {!chain ? "Unavailable" : chain.ok ? `Intact, ${chain.rows} entries` : `Broken at entry ${chain.firstBrokenSeq}`}
          </p>
          <p className="mt-1 text-[11.5px] text-subtle">Every entry is chained to the one before; an edited entry breaks the chain.</p>
        </div>
        <div className="card rounded-[14px] border border-border bg-background p-3.5">
          <p className="text-[12px] text-muted">Your recovery codes left</p>
          <p className={codesLeft <= 2 ? "mt-1 text-[15px] font-medium text-danger" : "mt-1 text-[15px] font-medium"}>{codesLeft}</p>
        </div>
        <div className="card rounded-[14px] border border-border bg-background p-3.5">
          <p className="text-[12px] text-muted">Your open admin sessions</p>
          <p className="mt-1 text-[15px] font-medium">{sessions.length}</p>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-medium text-muted">Your admin sessions</h2>
        <Table
          head={["Started", "Last active", "Method", "Platform", "Network"]}
          rows={sessions.map((s) => [
            timeAgo(s.createdAt),
            timeAgo(s.lastSeenAt),
            s.method === "recovery" ? "Recovery code" : "Authenticator",
            s.platform === "android" ? "Android app" : "Web",
            <span key="n" className="text-muted">
              {s.ipPrefix ?? "unknown"}
              {s.id === me.adminSession.id ? " · this one" : ""}
            </span>,
          ])}
          empty="No open admin sessions."
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-medium text-muted">Audit log (latest 100)</h2>
        <Table
          head={["When", "Action", "Resource", "Role", "Outcome", "Detail"]}
          rows={rows.map((r) => [
            <span key="w" className="text-muted">
              {timeAgo(r.createdAt)}
            </span>,
            <code key="a" className="font-mono text-[12px]">
              {r.action}
            </code>,
            <span key="r" className="text-muted">
              {r.resourceType}
              {r.resourceId ? ` ${r.resourceId.slice(0, 8)}` : ""}
            </span>,
            r.actorRole ?? "",
            <span key="o" className={r.outcome === "success" ? "" : "text-danger"}>
              {r.outcome}
            </span>,
            <span key="d" className="block max-w-[320px] truncate font-mono text-[11.5px] text-muted">
              {r.reason ?? (r.after ? JSON.stringify(r.after) : "")}
            </span>,
          ])}
          empty="No admin actions recorded yet."
        />
      </section>
    </div>
  );
}
