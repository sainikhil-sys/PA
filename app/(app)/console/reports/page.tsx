import Link from "next/link";
import { ReportActions } from "@/components/admin/report-actions";
import { requireAdmin } from "@/lib/admin/guard";
import { listReports, REASON_LABELS, REPORT_STATUSES, reportCounts, type ReportRow, type ReportStatus } from "@/lib/admin/reports";
import { cn, timeAgo } from "@/lib/utils";

const STATUS_LABEL: Record<ReportStatus, string> = { open: "Open", actioned: "Actioned", dismissed: "Dismissed" };

/** Reports people filed in the app, oldest open report first. */
export default async function ConsoleReports({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const q = (await searchParams).status;
  const status: ReportStatus = REPORT_STATUSES.includes(q as ReportStatus) ? (q as ReportStatus) : "open";
  const [reports, counts] = await Promise.all([listReports(status), reportCounts()]);

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Report status" className="flex flex-wrap gap-1.5">
        {REPORT_STATUSES.map((s) => (
          <Link
            key={s}
            href={s === "open" ? "/console/reports" : `/console/reports?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={cn("rounded-[10px] border px-3 py-1.5 text-[13px]", s === status ? "border-foreground font-medium" : "border-border text-muted hover:text-foreground")}
          >
            {STATUS_LABEL[s]} <span className="tabular text-muted">{counts[s]}</span>
          </Link>
        ))}
      </nav>
      {reports.length ? (
        <ul className="flex flex-col gap-2">
          {reports.map((r) => (
            <ReportCard key={r.id} r={r} />
          ))}
        </ul>
      ) : (
        <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">{status === "open" ? "No open reports." : `No ${STATUS_LABEL[status].toLowerCase()} reports yet.`}</p>
      )}
    </div>
  );
}

function ReportCard({ r }: { r: ReportRow }) {
  const who = r.targetHandle ? `@${r.targetHandle}` : (r.targetEmail ?? "Deleted account");
  return (
    <li className="card rounded-[14px] border border-border bg-background p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[14px] font-medium">
          {REASON_LABELS[r.reason] ?? r.reason} <span className="font-normal text-muted">about {who}</span>
        </p>
        <p className="text-[12px] text-muted">{timeAgo(r.createdAt)}</p>
      </div>
      <dl className="mt-2 grid gap-1 text-[13px] sm:grid-cols-[120px_1fr]">
        <dt className="text-muted">Reported account</dt>
        <dd className="min-w-0 truncate">
          {r.targetEmail ?? "Deleted account"}
          {r.targetDisabled ? <span className="text-danger"> (disabled)</span> : null}
        </dd>
        <dt className="text-muted">Reported by</dt>
        <dd className="min-w-0 truncate">{r.reporterEmail ?? (r.details?.startsWith("Automatic check") ? "Automatic check" : "Deleted account")}</dd>
        {r.details ? (
          <>
            <dt className="text-muted">Their note</dt>
            <dd className="whitespace-pre-wrap">{r.details}</dd>
          </>
        ) : null}
        {r.postId || r.commentId ? (
          <>
            <dt className="text-muted">{r.postId ? "Post" : "Comment"}</dt>
            <dd className="whitespace-pre-wrap">
              {r.snapshot ? <span className="block rounded-[10px] bg-surface px-2.5 py-1.5">{r.snapshot}</span> : <span className="text-muted">No text</span>}
              {r.contentRemoved ? <span className="mt-1 block text-[12px] text-muted">Taken down or deleted</span> : null}
            </dd>
          </>
        ) : null}
        {r.messageId ? (
          <>
            <dt className="text-muted">Message</dt>
            <dd className="whitespace-pre-wrap">
              {r.snapshot ? <span className="block rounded-[10px] bg-surface px-2.5 py-1.5">{r.snapshot}</span> : <span className="text-muted">Not captured</span>}
              {r.messageDeleted ? <span className="mt-1 block text-[12px] text-muted">Removed from the chat</span> : null}
            </dd>
          </>
        ) : null}
        {r.status !== "open" ? (
          <>
            <dt className="text-muted">Reviewed</dt>
            <dd>
              {r.reviewerEmail ?? "Deleted account"}
              {r.reviewedAt ? `, ${timeAgo(r.reviewedAt)}` : ""}
            </dd>
          </>
        ) : null}
      </dl>
      {r.status === "open" ? (
        <div className="mt-3">
          <ReportActions
            reportId={r.id}
            canRemoveMessage={Boolean(r.messageId && !r.messageDeleted)}
            canRemoveContent={Boolean((r.postId || r.commentId) && !r.contentRemoved)}
            canDisable={Boolean(r.targetId && !r.targetDisabled)}
          />
        </div>
      ) : null}
    </li>
  );
}
