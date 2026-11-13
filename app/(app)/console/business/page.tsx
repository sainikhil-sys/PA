import { desc, eq } from "drizzle-orm";
import { VerificationDecision } from "@/components/admin/business-actions";
import { requireAdmin } from "@/lib/admin/guard";
import { emailInDomain } from "@/lib/anonymous/identity";
import { db, schema } from "@/lib/db";
import { timeAgo } from "@/lib/utils";

/** Business verification requests, oldest first, and the latest decisions. */
export default async function ConsoleBusiness() {
  await requireAdmin("network.verify");
  const v = schema.orgVerifications;
  const o = schema.organizations;
  const rows = await db()
    .select({ id: v.id, email: v.email, note: v.note, status: v.status, reviewNote: v.reviewNote, createdAt: v.createdAt, reviewedAt: v.reviewedAt, orgId: o.id, orgName: o.name, domain: o.emailDomain, website: o.website, industry: o.industry, country: o.country })
    .from(v)
    .innerJoin(o, eq(o.id, v.orgId))
    .orderBy(desc(v.createdAt))
    .limit(200);
  const pending = rows.filter((r) => r.status === "pending").reverse();
  const decided = rows.filter((r) => r.status !== "pending").slice(0, 30);

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Waiting for review" className="flex flex-col gap-2">
        <h2 className="text-[14px] font-medium">Waiting for review ({pending.length})</h2>
        {pending.length ? (
          <ul className="flex flex-col gap-2">
            {pending.map((r) => {
              const matches = emailInDomain(r.email, r.domain);
              return (
                <li key={r.id} className="card flex flex-col gap-2 rounded-[14px] border border-border bg-background p-3.5 text-[13px]">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[14px] font-medium">{r.orgName}</p>
                    <p className="text-muted">{timeAgo(r.createdAt)}</p>
                  </div>
                  <dl className="grid gap-1 sm:grid-cols-[140px_1fr]">
                    <dt className="text-muted">Domain</dt>
                    <dd>{r.domain}</dd>
                    <dt className="text-muted">Requested by</dt>
                    <dd>
                      {r.email} {matches ? <span className="text-muted">(at the domain)</span> : <span className="text-danger">(not at the domain)</span>}
                    </dd>
                    {r.website ? (
                      <>
                        <dt className="text-muted">Website</dt>
                        <dd className="truncate">{r.website}</dd>
                      </>
                    ) : null}
                    {r.industry || r.country ? (
                      <>
                        <dt className="text-muted">Industry, country</dt>
                        <dd>{[r.industry, r.country].filter(Boolean).join(", ")}</dd>
                      </>
                    ) : null}
                    {r.note ? (
                      <>
                        <dt className="text-muted">Their note</dt>
                        <dd className="whitespace-pre-wrap">{r.note}</dd>
                      </>
                    ) : null}
                  </dl>
                  <VerificationDecision verificationId={r.id} orgName={r.orgName} domainMatches={matches} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">No organizations are waiting for verification.</p>
        )}
      </section>
      {decided.length ? (
        <section aria-label="Recent decisions" className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Recent decisions</h2>
          <ul className="flex flex-col gap-1 text-[13px]">
            {decided.map((r) => (
              <li key={r.id}>
                {r.orgName} <span className="text-muted">({r.domain})</span>: {r.status === "approved" ? "verified" : "rejected"}
                {r.reviewedAt ? <span className="text-muted">, {timeAgo(r.reviewedAt)}</span> : null}
                {r.reviewNote ? <span className="text-muted">. {r.reviewNote}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
