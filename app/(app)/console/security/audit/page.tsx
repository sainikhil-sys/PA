import Link from "next/link";
import { Table } from "@/components/admin/parts";
import { ExportAuditButton } from "@/components/admin/security-audit-export";
import { Button } from "@/components/ui/button";
import { inputClass, Label } from "@/components/ui/input";
import { verifyAuditChain } from "@/lib/admin/audit";
import { requireAdmin } from "@/lib/admin/guard";
import { AUDIT_PAGE_SIZE, auditEntry, auditFilterSchema, queryAudit, type AuditFilters } from "@/lib/admin/ops/security";
import { can } from "@/lib/admin/permissions";
import { cn, timeAgo } from "@/lib/utils";

type Search = Record<string, string | string[] | undefined>;
const FILTER_KEYS = ["actor", "action", "resourceType", "resourceId", "outcome", "from", "to"] as const;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.slice(0, 400) ?? "";
}

function href(filters: Record<string, string>, extra: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v !== undefined && v !== "") p.set(k, String(v));
  const q = p.toString();
  return `/console/security/audit${q ? `?${q}` : ""}`;
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p className="text-[12.5px] text-muted">None</p>;
  return <pre className="max-h-[320px] overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-[12px] leading-relaxed">{JSON.stringify(value, null, 2)}</pre>;
}

export default async function ConsoleAudit({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireAdmin("audit.read");
  const sp = await searchParams;
  const raw = Object.fromEntries(FILTER_KEYS.map((k) => [k, one(sp[k])])) as Record<(typeof FILTER_KEYS)[number], string>;
  const parsed = auditFilterSchema.safeParse(raw);
  const filters: AuditFilters = parsed.success ? parsed.data : {};
  // Links keep only filters that passed validation.
  const kept: Record<string, string> = parsed.success ? Object.fromEntries(Object.entries(raw).filter(([, v]) => v)) : {};
  const pageNum = Math.min(10_000, Math.max(1, Number.parseInt(one(sp.page), 10) || 1));
  const seq = Number.parseInt(one(sp.seq), 10);

  const [result, entry, chain] = await Promise.all([
    queryAudit(filters, pageNum).catch(() => null),
    Number.isSafeInteger(seq) && seq > 0 ? auditEntry(seq).catch(() => null) : Promise.resolve(null),
    verifyAuditChain().catch(() => null),
  ]);
  const canExport = can(me.adminRole, "security.policy");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[13px]">
          <Link href="/console/security" className="text-muted underline-offset-4 hover:text-foreground hover:underline">
            Security
          </Link>
          <span className="text-subtle">/</span>
          <span className="font-medium">Audit log</span>
        </div>
        <p className={cn("text-[12.5px]", chain && !chain.ok ? "font-medium text-danger" : "text-muted")}>
          Chain check: {!chain ? "unavailable" : chain.ok ? `intact, ${chain.rows.toLocaleString("en-US")} entries` : `broken at entry ${chain.firstBrokenSeq}`}
        </p>
      </div>

      <form method="get" action="/console/security/audit" className="card grid gap-3 rounded-md border border-border bg-background p-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-actor">Person (email or account id)</Label>
          <input id="f-actor" name="actor" defaultValue={raw.actor} maxLength={320} className={cn(inputClass, "h-9 text-[13px]")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-action">Action (or its start)</Label>
          <input id="f-action" name="action" defaultValue={raw.action} maxLength={80} placeholder="role." className={cn(inputClass, "h-9 text-[13px]")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-rt">Resource type</Label>
          <input id="f-rt" name="resourceType" defaultValue={raw.resourceType} maxLength={40} placeholder="user" className={cn(inputClass, "h-9 text-[13px]")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-rid">Resource id</Label>
          <input id="f-rid" name="resourceId" defaultValue={raw.resourceId} maxLength={100} className={cn(inputClass, "h-9 text-[13px]")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-outcome">Outcome</Label>
          <select id="f-outcome" name="outcome" defaultValue={raw.outcome} className={cn(inputClass, "h-9 py-0 text-[13px]")}>
            <option value="">Any</option>
            <option value="success">Success</option>
            <option value="denied">Denied</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-from">From (UTC)</Label>
          <input id="f-from" name="from" type="date" defaultValue={raw.from} className={cn(inputClass, "h-9 text-[13px]")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-to">To (UTC, inclusive)</Label>
          <input id="f-to" name="to" type="date" defaultValue={raw.to} className={cn(inputClass, "h-9 text-[13px]")} />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm" variant="primary">
            Apply
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/console/security/audit">Clear</Link>
          </Button>
          {canExport ? <ExportAuditButton filters={kept} /> : null}
        </div>
      </form>
      {!parsed.success ? <p className="text-[13px] text-danger">{parsed.error.issues[0]?.message ?? "Check the filters."} Showing everything instead.</p> : null}

      {entry ? (
        <section className="card flex flex-col gap-3 rounded-md border border-border bg-background p-3.5" aria-label={`Audit entry ${entry.seq}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-medium">
              Entry {entry.seq}: <code className="font-mono text-[13px]">{entry.action}</code>
            </h2>
            <Link href={href(kept, { page: pageNum > 1 ? pageNum : undefined })} className="text-[12.5px] text-muted underline-offset-4 hover:underline">
              Close
            </Link>
          </div>
          <dl className="grid gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted">When</dt>
            <dd className="tabular">{entry.createdAt.replace("T", " ").slice(0, 19)} UTC</dd>
            <dt className="text-muted">Person</dt>
            <dd>
              {entry.actorEmail ?? "Deleted account"} <span className="text-muted">{entry.actorRole ?? ""}</span>
            </dd>
            <dt className="text-muted">Resource</dt>
            <dd>
              {entry.resourceType} <code className="text-[12px] text-muted">{entry.resourceId ?? ""}</code>
            </dd>
            <dt className="text-muted">Outcome</dt>
            <dd className={entry.outcome === "success" ? "" : "text-danger"}>{entry.outcome}</dd>
            <dt className="text-muted">Reason</dt>
            <dd>{entry.reason ?? "None"}</dd>
            <dt className="text-muted">Network</dt>
            <dd>{entry.ipPrefix ?? "Unknown"}</dd>
            <dt className="text-muted">Device</dt>
            <dd className="break-all text-muted">{entry.userAgent ?? "Unknown"}</dd>
            <dt className="text-muted">Request</dt>
            <dd className="break-all font-mono text-[11.5px] text-muted">{entry.requestId ?? "None"}</dd>
            <dt className="text-muted">Hash</dt>
            <dd className="break-all font-mono text-[11.5px] text-muted">{entry.hash}</dd>
          </dl>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] text-muted">Before</p>
              <Json value={entry.before} />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] text-muted">After</p>
              <Json value={entry.after} />
            </div>
          </div>
        </section>
      ) : Number.isSafeInteger(seq) && seq > 0 ? (
        <p className="text-[13px] text-muted">There is no audit entry {seq}.</p>
      ) : null}

      {result ? (
        <>
          <Table
            head={["#", "When", "Person", "Action", "Resource", "Outcome", "Reason"]}
            rows={result.rows.map((r) => [
              <Link key="s" href={href(kept, { page: pageNum > 1 ? pageNum : undefined, seq: r.seq })} className="tabular underline-offset-4 hover:underline">
                {r.seq}
              </Link>,
              <span key="w" className="text-muted" title={r.createdAt}>
                {timeAgo(r.createdAt)}
              </span>,
              <span key="p">
                {r.actorEmail ?? <span className="text-muted">Deleted account</span>}
                {r.actorRole ? <span className="text-muted"> {r.actorRole}</span> : null}
              </span>,
              <code key="a" className="font-mono text-[12px]">
                {r.action}
              </code>,
              <span key="r" className="text-muted">
                {r.resourceType}
                {r.resourceId ? ` ${r.resourceId.slice(0, 8)}` : ""}
              </span>,
              <span key="o" className={r.outcome === "success" ? "" : "text-danger"}>
                {r.outcome}
              </span>,
              <span key="d" className="block max-w-[260px] truncate text-[12px] text-muted">
                {r.reason ?? ""}
              </span>,
            ])}
            empty={Object.keys(kept).length ? "No entries match these filters." : "No admin actions recorded yet."}
          />
          <nav className="flex items-center justify-between text-[13px]" aria-label="Pages">
            {pageNum > 1 ? (
              <Link href={href(kept, { page: pageNum - 1 > 1 ? pageNum - 1 : undefined })} className="underline-offset-4 hover:underline">
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="tabular text-muted">
              Page {pageNum}, {AUDIT_PAGE_SIZE} per page
            </span>
            {result.hasMore ? (
              <Link href={href(kept, { page: pageNum + 1 })} className="underline-offset-4 hover:underline">
                Older
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      ) : (
        <p className="rounded-md border border-border p-4 text-[13px] text-muted">The audit log is unavailable: the database didn&apos;t answer. Try again in a minute.</p>
      )}
    </div>
  );
}
