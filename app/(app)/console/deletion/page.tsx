import Link from "next/link";
import { Table } from "@/components/admin/parts";
import { DeletionActions, RecordDeletionForm } from "@/components/admin/deletion-queue";
import { requireAdmin } from "@/lib/admin/guard";
import { listDeletionRequests } from "@/lib/admin/ops/deletion";
import { can } from "@/lib/admin/permissions";
import { cn } from "@/lib/utils";

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const STATUS = { received: "Received", verified: "Verified", completed: "Completed", rejected: "Rejected" } as const;

export default async function ConsoleDeletion() {
  const me = await requireAdmin("users.deletion_request");
  const canComplete = can(me.adminRole, "users.delete");
  const rows = await listDeletionRequests().catch(() => null);
  const open = rows?.filter((r) => r.status === "received" || r.status === "verified") ?? [];
  const closed = rows?.filter((r) => r.status === "completed" || r.status === "rejected") ?? [];
  const overdue = open.filter((r) => r.overdue).length;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-muted">
        Requests that arrive by email. Verify that each one came from the address the account signs in with.{" "}
        {canComplete ? "Deleting the account is final and needs a fresh unlock." : "Only the owner can delete the account."}
      </p>
      <RecordDeletionForm />

      {!rows ? (
        <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">Unavailable: the database didn&apos;t answer. Try again in a minute.</p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-[15px] font-medium">
              Open <span className="tabular text-muted">({open.length})</span>
              {overdue ? <span className="ml-2 text-[13px] font-normal text-danger">{overdue} overdue</span> : null}
            </h2>
            <Table
              empty="No open requests."
              head={["Account", "Status", "Received", "Due", "Note", ""]}
              rows={open.map((r) => [
                r.userId && r.email ? (
                  <Link key="a" href={`/console/users/${r.userId}`} className="block max-w-[240px] truncate hover:underline">
                    {r.email}
                  </Link>
                ) : (
                  <span key="a" className="text-muted">
                    No account uses this address
                  </span>
                ),
                <span key="s">{STATUS[r.status]}</span>,
                <span key="c" className="tabular text-muted">
                  {day(r.createdAt)}
                  {r.source === "support" ? ", support" : ""}
                </span>,
                <span key="d" className={cn("tabular", r.overdue ? "font-medium text-danger" : r.daysLeft <= 7 ? "text-foreground" : "text-muted")}>
                  {day(r.dueBy)}
                  {r.overdue ? `, ${-r.daysLeft} day${r.daysLeft === -1 ? "" : "s"} overdue` : `, ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left`}
                </span>,
                <span key="n" className="line-clamp-2 max-w-[220px] whitespace-pre-line text-[12px] text-muted">
                  {r.note ?? ""}
                </span>,
                <DeletionActions key="x" id={r.id} status={r.status as "received" | "verified"} canComplete={canComplete} hasAccount={Boolean(r.userId)} />,
              ])}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[15px] font-medium">Closed</h2>
            <Table
              empty="Nothing closed yet."
              head={["Account", "Outcome", "Received", "Closed", "Note"]}
              rows={closed.map((r) => [
                <span key="a" className="text-muted">
                  {r.email ?? (r.status === "completed" ? "Deleted" : "No account")}
                </span>,
                <span key="s">{STATUS[r.status]}</span>,
                <span key="c" className="tabular text-muted">
                  {day(r.createdAt)}
                </span>,
                <span key="d" className="tabular text-muted">
                  {r.completedAt ? day(r.completedAt) : ""}
                </span>,
                <span key="n" className="line-clamp-2 max-w-[260px] whitespace-pre-line text-[12px] text-muted">
                  {r.note ?? ""}
                </span>,
              ])}
            />
          </section>
        </>
      )}
    </div>
  );
}
