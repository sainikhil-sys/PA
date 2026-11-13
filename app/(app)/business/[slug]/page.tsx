import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ApiForm, toIso, toMinor } from "@/components/business/act";
import { requireOwner } from "@/lib/auth/session";
import { getOrg, listPartnerships, myOrgs } from "@/lib/business/orgs";
import { db, schema } from "@/lib/db";
import { SocialError } from "@/lib/social/service";

export const metadata: Metadata = { title: "Organization" };
export const dynamic = "force-dynamic";

/** An organization: profile, verification, representatives, partnerships and requirements. */
export default async function OrgPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireOwner();
  const { slug } = await params;
  const org = await getOrg(user, decodeURIComponent(slug)).catch((err) => {
    if (err instanceof SocialError) return null;
    throw err;
  });
  if (!org) notFound();
  const [partnerships, mine, reqs] = await Promise.all([
    org.myRole ? listPartnerships(user, org.id) : Promise.resolve([]),
    myOrgs(user),
    db()
      .select({ id: schema.requirements.id, title: schema.requirements.title, status: schema.requirements.status })
      .from(schema.requirements)
      .where(and(eq(schema.requirements.orgId, org.id)))
      .orderBy(desc(schema.requirements.createdAt))
      .limit(50),
  ]);
  const visibleReqs = org.myRole ? reqs : reqs.filter((r) => r.status === "open");
  const myAdminOrgs = mine.filter((m) => (m.myRole === "owner" || m.myRole === "admin") && m.verified && m.id !== org.id);

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-3">
      <Link href="/business" className="text-[13px] text-muted hover:text-foreground">
        Business
      </Link>
      <header className="card flex flex-col gap-2 rounded-[14px] border border-border bg-background p-5">
        <h1 className="font-serif text-[26px] leading-tight">{org.name}</h1>
        <p className="text-[13px] text-muted">
          {org.verified ? `Verified · ${org.emailDomain}` : org.verification === "pending" ? "Verification pending" : "Not verified"}
          {org.industry ? ` · ${org.industry}` : ""}
          {org.country ? ` · ${[org.city, org.country].filter(Boolean).join(", ")}` : ""}
          {org.roles.length ? ` · ${org.roles.join(", ")}` : ""}
          {org.suspended ? " · Suspended" : ""}
        </p>
        {org.description ? <p className="whitespace-pre-wrap text-[14px] leading-6">{org.description}</p> : null}
        {org.website ? (
          <a href={org.website} rel="noopener noreferrer nofollow" target="_blank" className="self-start text-[13px] underline">
            {org.website}
          </a>
        ) : null}
        {org.canManage && !org.verified && org.verification !== "pending" ? (
          <ActionButton url={`/api/orgs/${org.id}/verification`} body={{}} label="Ask for verification" done="Sent. An admin will review it." variant="primary" />
        ) : null}
        {myAdminOrgs.length && !org.myRole ? (
          <ActionButton url={`/api/orgs/${myAdminOrgs[0]!.id}/partnerships`} body={{ toOrgId: org.id }} label={`Propose a partnership from ${myAdminOrgs[0]!.name}`} done="Sent" />
        ) : null}
      </header>

      <section aria-label="Representatives" className="card rounded-[14px] border border-border bg-background p-4">
        <h2 className="text-[14px] font-medium">Representatives</h2>
        <ul className="mt-2 flex flex-col gap-1 text-[14px]">
          {org.members.map((m) => (
            <li key={m.userId}>
              <Link href={`/u/${m.handle}`} className="font-medium">
                {m.name}
              </Link>{" "}
              <span className="text-muted">
                {m.role}
                {m.title ? `, ${m.title}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {org.canManage ? (
          <ApiForm
            url={`/api/orgs/${org.id}/members`}
            submit="Add"
            done="Added"
            className="mt-3 flex flex-col gap-2"
            fields={[
              { name: "handle", label: `Add a representative by handle (their sign-in email must be at ${org.emailDomain})`, required: true, placeholder: "@handle" },
              { name: "title", label: "Their title (optional)", max: 80 },
            ]}
          />
        ) : null}
      </section>

      {org.myRole && partnerships.length ? (
        <section aria-label="Partnerships" className="card rounded-[14px] border border-border bg-background p-4">
          <h2 className="text-[14px] font-medium">Partnerships</h2>
          <ul className="mt-2 flex flex-col gap-2 text-[14px]">
            {partnerships.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {p.incoming ? "From " : "To "}
                  <Link href={`/business/${p.other.slug}`} className="font-medium">
                    {p.other.name}
                  </Link>{" "}
                  <span className="text-muted">{p.status}</span>
                </span>
                {p.incoming && p.status === "pending" && org.canManage ? (
                  <span className="flex gap-1.5">
                    <ActionButton url={`/api/partnerships/${p.id}`} body={{ accept: true }} label="Accept" variant="primary" />
                    <ActionButton url={`/api/partnerships/${p.id}`} body={{ accept: false }} label="Decline" variant="ghost" />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Requirements" className="card flex flex-col gap-2 rounded-[14px] border border-border bg-background p-4">
        <h2 className="text-[14px] font-medium">Requirements</h2>
        {visibleReqs.length ? (
          <ul className="flex flex-col gap-1 text-[14px]">
            {visibleReqs.map((r) => (
              <li key={r.id}>
                <Link href={`/requirements/${r.id}`} className="underline">
                  {r.title}
                </Link>{" "}
                <span className="text-muted">{r.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">None open.</p>
        )}
        {org.canAct && org.verified ? (
          <details className="text-[14px]">
            <summary className="cursor-pointer text-muted">Post a requirement</summary>
            <ApiForm
              url="/api/requirements"
              submit="Post"
              extra={{ orgId: org.id }}
              goTo="/requirements/{id}"
              className="mt-2 flex flex-col gap-2"
              fields={[
                { name: "title", label: "What you need", required: true, max: 140 },
                { name: "description", label: "Details", type: "textarea", max: 5000 },
                { name: "category", label: "Category", max: 60 },
                { name: "quantity", label: "Quantity", max: 120 },
                { name: "budgetMinor", label: "Budget (optional)", type: "number", transform: toMinor },
                { name: "currency", label: "Currency", max: 3, initial: "USD" },
                { name: "deadline", label: "Quotes due by (optional)", type: "date", transform: toIso },
              ]}
            />
          </details>
        ) : org.canAct ? (
          <p className="text-[13px] text-muted">Verify the organization to post requirements.</p>
        ) : null}
      </section>
    </div>
  );
}
