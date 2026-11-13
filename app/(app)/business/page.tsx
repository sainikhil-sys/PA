import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiForm } from "@/components/business/act";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { myDeals, openRequirements } from "@/lib/business/deals";
import { discoverOrgs, myOrgs, requireBusiness } from "@/lib/business/orgs";
import { getProfile, SocialError } from "@/lib/social/service";
import { formatMinor } from "@/components/business/format";

export const metadata: Metadata = { title: "Business" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { awaiting_approval: "Waiting for approval", agreed: "Agreed", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };

/** The business network: your organizations and deals, open requirements, and who's on Cowork. */
export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string }> }) {
  const user = await requireOwner();
  if (!user.birthDate || !(await getProfile(user.id))) redirect("/feed");
  const gate = await requireBusiness(user).catch((err) => (err instanceof SocialError ? err.message : Promise.reject(err)));
  if (typeof gate === "string")
    return (
      <div className="mx-auto max-w-[760px]">
        <PageHeader title="Business" />
        <p className="rounded-[14px] border border-border p-4 text-[14px] text-muted">{gate}</p>
      </div>
    );
  const sp = await searchParams;
  const [mine, deals, reqs, found] = await Promise.all([myOrgs(user), myDeals(user), openRequirements(user), discoverOrgs(user, { q: sp.q, role: sp.role })]);
  const domain = user.email.split("@")[1] ?? "";

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-4">
      <PageHeader title="Business" description="Find suppliers and buyers, post requirements, compare quotes and agree deals." />
      <section aria-label="Your organizations" className="flex flex-col gap-2">
        <h2 className="text-[14px] font-medium">Your organizations</h2>
        {mine.length ? (
          <ul className="flex flex-col gap-2">
            {mine.map((o) => (
              <li key={o.id}>
                <Link href={`/business/${o.slug}`} className="card flex items-center justify-between gap-2 rounded-[14px] border border-border bg-background p-3.5 hover:border-border-strong">
                  <span className="text-[14px] font-medium">{o.name}</span>
                  <span className="text-[12px] text-muted">
                    {o.verified ? "Verified" : o.verification === "pending" ? "Verification pending" : "Not verified"} · {o.myRole}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <details className="text-[14px]">
          <summary className="cursor-pointer text-muted">Add your organization</summary>
          <p className="mt-2 text-[13px] text-muted">You can add an organization for the domain of the email you signed in with ({domain}).</p>
          <ApiForm
            url="/api/orgs"
            submit="Create"
            goTo="/business/{id}"
            extra={{ emailDomain: domain }}
            className="mt-2 card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4"
            fields={[
              { name: "name", label: "Organization name", required: true, max: 80 },
              { name: "industry", label: "Industry", max: 60 },
              { name: "roles", label: "On Cowork it (comma separated: buyer, supplier, partner)", list: true, placeholder: "buyer, supplier" },
              { name: "country", label: "Country", max: 60 },
              { name: "website", label: "Website (https://...)", max: 200 },
              { name: "description", label: "About", type: "textarea", max: 3000 },
            ]}
          />
        </details>
      </section>

      {deals.length ? (
        <section aria-label="Deals" className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Deals</h2>
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {deals.map((d) => (
              <li key={d.id}>
                <Link href={`/deals/${d.id}`} className="underline">
                  {d.title}
                </Link>{" "}
                <span className="text-muted">
                  {formatMinor(d.amountMinor, d.currency)} · {STATUS[d.status] ?? d.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Open requirements" className="flex flex-col gap-2">
        <h2 className="text-[14px] font-medium">Open requirements</h2>
        {reqs.items.length ? (
          <ul className="flex flex-col gap-2">
            {reqs.items.map((r) => (
              <li key={r.id}>
                <Link href={`/requirements/${r.id}`} className="card block rounded-[14px] border border-border bg-background p-3.5 hover:border-border-strong">
                  <span className="block text-[14px] font-medium">{r.title}</span>
                  <span className="block text-[12px] text-muted">
                    {r.orgName}
                    {r.quantity ? ` · ${r.quantity}` : ""}
                    {r.budgetMinor ? ` · budget ${formatMinor(r.budgetMinor, r.currency)}` : ""}
                    {r.deadline ? ` · by ${new Date(r.deadline).toLocaleDateString("en-GB")}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">No open requirements right now.</p>
        )}
      </section>

      <section aria-label="Organizations" className="flex flex-col gap-2">
        <h2 className="text-[14px] font-medium">Organizations</h2>
        <form className="flex flex-wrap gap-2" action="/business">
          <label htmlFor="bq" className="sr-only">
            Search organizations
          </label>
          <input id="bq" name="q" defaultValue={sp.q ?? ""} placeholder="Name, industry or product" className="h-10 min-w-0 flex-1 rounded-[10px] border border-border bg-background px-3 text-[14px]" />
          <select name="role" defaultValue={sp.role ?? ""} aria-label="Role" className="h-10 rounded-[10px] border border-border bg-background px-2 text-[14px]">
            <option value="">Any</option>
            <option value="supplier">Suppliers</option>
            <option value="buyer">Buyers</option>
            <option value="partner">Partners</option>
          </select>
          <button type="submit" className="h-10 rounded-[10px] border border-border px-4 text-[14px]">
            Search
          </button>
        </form>
        {found.items.length ? (
          <ul className="flex flex-col gap-2">
            {found.items.map((o) => (
              <li key={o.id}>
                <Link href={`/business/${o.slug}`} className="card block rounded-[14px] border border-border bg-background p-3.5 hover:border-border-strong">
                  <span className="text-[14px] font-medium">{o.name}</span> {o.verified ? <span className="text-[12px] text-muted">· Verified</span> : null}
                  <span className="block text-[12px] text-muted">{[o.industry, o.roles.join(", "), o.country].filter(Boolean).join(" · ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">{sp.q ? "No organizations match that." : "No organizations yet."}</p>
        )}
      </section>
    </div>
  );
}
