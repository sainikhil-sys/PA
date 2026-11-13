import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ApiForm, toIso, toMinor } from "@/components/business/act";
import { formatMinor } from "@/components/business/format";
import { requireOwner } from "@/lib/auth/session";
import { getRequirement } from "@/lib/business/deals";
import { myOrgs } from "@/lib/business/orgs";
import { SocialError } from "@/lib/social/service";

export const metadata: Metadata = { title: "Requirement" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QSTATUS: Record<string, string> = { submitted: "Submitted", shortlisted: "Shortlisted", accepted: "Accepted", rejected: "Not chosen", withdrawn: "Withdrawn" };

/** A requirement. Buyers compare quotes and accept one; suppliers send or follow their quote. */
export default async function RequirementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await getRequirement(user, id).catch((err) => {
    if (err instanceof SocialError) return null;
    throw err;
  });
  if (!data) notFound();
  const { requirement: r, isBuyer, quotes } = data;
  const mine = await myOrgs(user);
  const supplierOrgs = mine.filter((o) => o.verified && o.id !== r.orgId && !quotes.some((q) => q.supplierOrgId === o.id));

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-3">
      <Link href="/business" className="text-[13px] text-muted hover:text-foreground">
        Business
      </Link>
      <header className="card flex flex-col gap-2 rounded-[14px] border border-border bg-background p-5">
        <h1 className="font-serif text-[24px] leading-tight">{r.title}</h1>
        <p className="text-[13px] text-muted">
          <Link href={`/business/${r.buyerSlug}`} className="underline">
            {r.buyerName}
          </Link>
          {r.category ? ` · ${r.category}` : ""}
          {r.quantity ? ` · ${r.quantity}` : ""}
          {r.budgetMinor ? ` · budget ${formatMinor(r.budgetMinor, r.currency)}` : ""}
          {r.deadline ? ` · quotes by ${new Date(r.deadline).toLocaleDateString("en-GB")}` : ""} · {r.status}
        </p>
        {r.description ? <p className="whitespace-pre-wrap text-[14px] leading-6">{r.description}</p> : null}
        {isBuyer && r.status === "open" ? <ActionButton url={`/api/requirements/${r.id}`} method="PATCH" body={{ status: "closed" }} label="Stop taking quotes" confirm="Close this requirement to new quotes?" /> : null}
      </header>

      <section aria-label="Quotes" className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
        <h2 className="text-[14px] font-medium">{isBuyer ? `Quotes (${quotes.length})` : "Your quote"}</h2>
        {quotes.length ? (
          <ul className="flex flex-col gap-3">
            {quotes.map((q) => (
              <li key={q.id} className="flex flex-col gap-1.5 border-b border-border pb-3 text-[14px] last:border-b-0 last:pb-0">
                <p>
                  <Link href={`/business/${q.supplierSlug}`} className="font-medium">
                    {q.supplierName}
                  </Link>{" "}
                  <span className="text-muted">
                    {formatMinor(q.amountMinor, q.currency)}
                    {q.deliveryDays !== null ? ` · ${q.deliveryDays} days` : ""} · version {q.version} · {QSTATUS[q.status] ?? q.status}
                  </span>
                </p>
                {q.terms ? <p className="whitespace-pre-wrap text-[13px] text-muted">{q.terms}</p> : null}
                <span className="flex flex-wrap gap-1.5">
                  <Link href={`/quotes/${q.id}`} className="inline-flex h-9 items-center rounded-[10px] border border-border px-3 text-[13px]">
                    Negotiate
                  </Link>
                  {isBuyer && ["submitted", "shortlisted"].includes(q.status) && r.status === "open" ? (
                    <>
                      {q.status === "submitted" ? <ActionButton url={`/api/quotes/${q.id}`} method="PATCH" body={{ status: "shortlisted" }} label="Shortlist" /> : null}
                      <ActionButton url={`/api/quotes/${q.id}/accept`} body={{}} label="Accept" variant="primary" confirm="Accept this quote? It opens a deal; the supplier then approves the terms." goTo="/deals/{id}" />
                      <ActionButton url={`/api/quotes/${q.id}`} method="PATCH" body={{ status: "rejected" }} label="Not this one" variant="ghost" />
                    </>
                  ) : null}
                  {!isBuyer && ["submitted", "shortlisted"].includes(q.status) ? <ActionButton url={`/api/quotes/${q.id}`} method="PATCH" body={{ status: "withdrawn" }} label="Withdraw" variant="ghost" confirm="Withdraw your quote?" /> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">{isBuyer ? "No quotes yet." : "You haven't quoted yet."}</p>
        )}
        {!isBuyer && r.status === "open" && supplierOrgs.length ? (
          <ApiForm
            url={`/api/requirements/${r.id}/quotes`}
            submit="Send quote"
            done="Quote sent"
            className="flex flex-col gap-2 border-t border-border pt-3"
            fields={[
              { name: "supplierOrgId", label: "Quote as", type: "select", options: supplierOrgs.map((o) => [o.id, o.name] as [string, string]) },
              { name: "amountMinor", label: "Total price", type: "number", required: true, transform: toMinor },
              { name: "currency", label: "Currency", required: true, max: 3, initial: r.currency },
              { name: "deliveryDays", label: "Delivery in (days)", type: "number" },
              { name: "validUntil", label: "Valid until (optional)", type: "date", transform: toIso },
              { name: "terms", label: "Terms", type: "textarea", max: 5000 },
            ]}
          />
        ) : !isBuyer && r.status === "open" && !mine.some((o) => o.verified) ? (
          <p className="text-[13px] text-muted">To quote, act for a verified organization. Add yours on the Business page.</p>
        ) : null}
      </section>
    </div>
  );
}
