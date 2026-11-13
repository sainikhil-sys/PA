import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiForm, toMinor } from "@/components/business/act";
import { formatMinor } from "@/components/business/format";
import { requireOwner } from "@/lib/auth/session";
import { quoteHistory } from "@/lib/business/deals";
import { db, schema } from "@/lib/db";
import { SocialError } from "@/lib/social/service";
import { timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Negotiation" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One quote's negotiation: every version of the terms (who proposed it) and the conversation. */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const history = await quoteHistory(user, id).catch((err) => {
    if (err instanceof SocialError) return null;
    throw err;
  });
  if (!history) notFound();
  const [quote] = await db().select({ status: schema.quotes.status, requirementId: schema.quotes.requirementId, currency: schema.quotes.currency }).from(schema.quotes).where(eq(schema.quotes.id, id)).limit(1);
  const [deal] = await db().select({ id: schema.deals.id }).from(schema.deals).where(eq(schema.deals.quoteId, id)).limit(1);
  const open = quote && ["submitted", "shortlisted"].includes(quote.status);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3">
      <Link href={`/requirements/${quote?.requirementId}`} className="text-[13px] text-muted hover:text-foreground">
        Back to the requirement
      </Link>
      {deal ? (
        <Link href={`/deals/${deal.id}`} className="self-start text-[14px] underline">
          Open the deal
        </Link>
      ) : null}
      <section aria-label="Terms" className="card rounded-[14px] border border-border bg-background p-4">
        <h1 className="text-[16px] font-medium">Terms, newest last</h1>
        <ol className="mt-2 flex flex-col gap-2 text-[14px]">
          {history.versions.map((v) => (
            <li key={v.version}>
              <span className="font-medium">Version {v.version}</span>{" "}
              <span className="text-muted">
                from the {v.proposedBy} · {formatMinor(v.amountMinor, v.currency)}
                {v.deliveryDays !== null ? ` · ${v.deliveryDays} days` : ""} · {timeAgo(v.createdAt)}
              </span>
              {v.terms ? <p className="whitespace-pre-wrap text-[13px] text-muted">{v.terms}</p> : null}
            </li>
          ))}
        </ol>
        {open ? (
          <details className="mt-3 text-[14px]">
            <summary className="cursor-pointer text-muted">Propose new terms</summary>
            <ApiForm
              url={`/api/quotes/${id}/terms`}
              submit="Propose"
              done="Proposed"
              className="mt-2 flex flex-col gap-2"
              fields={[
                { name: "amountMinor", label: "Total price", type: "number", required: true, transform: toMinor },
                { name: "currency", label: "Currency", required: true, max: 3, initial: quote?.currency ?? "USD" },
                { name: "deliveryDays", label: "Delivery in (days)", type: "number" },
                { name: "terms", label: "Terms", type: "textarea", max: 5000 },
              ]}
            />
          </details>
        ) : null}
      </section>
      <section aria-label="Messages" className="card flex flex-col gap-2 rounded-[14px] border border-border bg-background p-4">
        <h2 className="text-[14px] font-medium">Messages</h2>
        {history.messages.length ? (
          <ul className="flex flex-col gap-2 text-[14px]">
            {history.messages.map((m) => (
              <li key={m.id}>
                <span className="font-medium">{m.name ?? "Someone"}</span> <span className="text-[12px] text-muted">{timeAgo(m.createdAt)}</span>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No messages yet.</p>
        )}
        <ApiForm url={`/api/quotes/${id}/messages`} submit="Send" className="flex flex-col gap-2 border-t border-border pt-3" fields={[{ name: "body", label: "Message", type: "textarea", required: true, max: 4000 }]} />
      </section>
    </div>
  );
}
