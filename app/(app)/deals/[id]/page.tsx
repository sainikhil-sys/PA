import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ApiForm, toIso } from "@/components/business/act";
import { formatMinor } from "@/components/business/format";
import { requireOwner } from "@/lib/auth/session";
import { getDeal } from "@/lib/business/deals";
import { SocialError } from "@/lib/social/service";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Deal" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, string> = { awaiting_approval: "Waiting for approval", agreed: "Agreed", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
const when = (d: Date) => d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** A deal between two organizations: approvals of the terms, then milestones and meetings. */
export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await getDeal(user, id).catch((err) => {
    if (err instanceof SocialError) return null;
    throw err;
  });
  if (!data) notFound();
  const { deal, side, myRole, buyer, supplier, approvals, milestones, meetings } = data;
  const isAdmin = myRole === "owner" || myRole === "admin";
  const myOrgId = side === "buyer" ? deal.buyerOrgId : deal.supplierOrgId;
  const decidedByUs = approvals.some((a) => a.orgId === myOrgId && a.termsVersion === deal.termsVersion);
  const active = deal.status === "agreed" || deal.status === "in_progress";

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3">
      <Link href="/business" className="text-[13px] text-muted hover:text-foreground">
        Business
      </Link>
      <header className="card flex flex-col gap-2 rounded-[14px] border border-border bg-background p-5">
        <h1 className="font-serif text-[24px] leading-tight">{deal.title}</h1>
        <p className="text-[14px]">
          {formatMinor(deal.amountMinor, deal.currency)} · terms version {deal.termsVersion} · <span className="font-medium">{STATUS[deal.status] ?? deal.status}</span>
        </p>
        <p className="text-[13px] text-muted">
          Buyer: <Link href={`/business/${buyer?.slug}`} className="underline">{buyer?.name}</Link> · Supplier: <Link href={`/business/${supplier?.slug}`} className="underline">{supplier?.name}</Link>
        </p>
        <Link href={`/quotes/${deal.quoteId}`} className="self-start text-[13px] underline">
          Terms history and messages
        </Link>
        <p className="text-[12px] text-muted">Approvals here are a record of each side's agreement inside Cowork, not a legal signature.</p>
        {isAdmin ? (
          <span className="flex flex-wrap gap-1.5">
            {deal.status === "awaiting_approval" && !decidedByUs ? (
              <>
                <ActionButton url={`/api/deals/${deal.id}/decision`} body={{ decision: "approved" }} label="Approve the terms" variant="primary" confirm="Approve these terms for your organization? This is recorded." />
                <ActionButton url={`/api/deals/${deal.id}/decision`} body={{ decision: "rejected" }} label="Reject" variant="danger" confirm="Reject the deal? The buyer's requirement reopens." />
              </>
            ) : null}
            {deal.status === "agreed" ? <ActionButton url={`/api/deals/${deal.id}`} method="PATCH" body={{ status: "in_progress" }} label="Start work" /> : null}
            {active ? <ActionButton url={`/api/deals/${deal.id}`} method="PATCH" body={{ status: "completed" }} label="Mark completed" confirm="Mark the deal completed?" /> : null}
            {deal.status !== "completed" && deal.status !== "cancelled" ? <ActionButton url={`/api/deals/${deal.id}`} method="PATCH" body={{ status: "cancelled" }} label="Cancel the deal" variant="ghost" confirm="Cancel this deal?" /> : null}
          </span>
        ) : null}
      </header>

      <section aria-label="Approvals" className="card rounded-[14px] border border-border bg-background p-4">
        <h2 className="text-[14px] font-medium">Approvals</h2>
        <ul className="mt-2 flex flex-col gap-1 text-[14px]">
          {approvals.map((a) => (
            <li key={a.id}>
              {a.orgId === deal.buyerOrgId ? buyer?.name : supplier?.name} {a.decision} version {a.termsVersion} <span className="text-muted">· {timeAgo(a.createdAt)}</span>
              {a.note ? <span className="text-muted">. {a.note}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Milestones" className="card flex flex-col gap-2 rounded-[14px] border border-border bg-background p-4">
        <h2 className="text-[14px] font-medium">Milestones</h2>
        {milestones.length ? (
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {milestones.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className={m.status === "done" ? "text-muted line-through" : undefined}>
                  {m.title}
                  {m.dueDate ? <span className="text-muted"> · due {m.dueDate}</span> : null}
                </span>
                <ActionButton url={`/api/milestones/${m.id}`} method="PATCH" body={{ done: m.status !== "done" }} label={m.status === "done" ? "Not done" : "Done"} variant="ghost" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">{active ? "No milestones yet." : "Milestones can be added once the deal is agreed."}</p>
        )}
        {active ? (
          <ApiForm
            url={`/api/deals/${deal.id}/milestones`}
            submit="Add milestone"
            className="flex flex-col gap-2 border-t border-border pt-3"
            fields={[
              { name: "title", label: "Milestone", required: true, max: 140 },
              { name: "dueDate", label: "Due (optional)", type: "date" },
            ]}
          />
        ) : null}
      </section>

      <section aria-label="Meetings" className="card flex flex-col gap-2 rounded-[14px] border border-border bg-background p-4">
        <h2 className="text-[14px] font-medium">Meetings</h2>
        {meetings.length ? (
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {meetings.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {m.title} <span className="text-muted">· {when(m.startsAt)}{m.location ? ` · ${m.location}` : ""}{m.cancelledAt ? " · cancelled" : ""}</span>
                </span>
                {!m.cancelledAt ? (
                  <span className="flex gap-1.5">
                    <a href={`/api/meetings/${m.id}/ics`} className="inline-flex h-9 items-center rounded-[10px] border border-border px-3 text-[13px]">
                      Add to calendar
                    </a>
                    <ActionButton url={`/api/meetings/${m.id}`} method="DELETE" label="Cancel" variant="ghost" confirm="Cancel this meeting?" />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No meetings yet.</p>
        )}
        {deal.status !== "completed" && deal.status !== "cancelled" ? (
          <ApiForm
            url={`/api/deals/${deal.id}/meetings`}
            submit="Schedule"
            done="Scheduled"
            className="flex flex-col gap-2 border-t border-border pt-3"
            fields={[
              { name: "title", label: "Meeting", required: true, max: 140 },
              { name: "startsAt", label: "Starts", type: "datetime-local", required: true, transform: toIso },
              { name: "endsAt", label: "Ends", type: "datetime-local", required: true, transform: toIso },
              { name: "location", label: "Where (a room, an address or a link)", max: 300 },
            ]}
          />
        ) : null}
      </section>
    </div>
  );
}
