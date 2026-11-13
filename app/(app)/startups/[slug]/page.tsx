import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnswerInterest, InterestButton } from "@/components/startups/forms";
import { requireOwner } from "@/lib/auth/session";
import { getStartup, listInterests, matchPeople } from "@/lib/startups/service";
import { SocialError } from "@/lib/social/service";

export const metadata: Metadata = { title: "Startup" };
export const dynamic = "force-dynamic";

const STAGE: Record<string, string> = { idea: "Idea", prototype: "Prototype", launched: "Launched", revenue: "Earning revenue" };
const ROLE: Record<string, string> = { founder: "Founder", cofounder: "Co-founder", member: "Team", mentor: "Mentor", advisor: "Advisor" };
const KIND: Record<string, string> = { cofounder: "co-founder", collaborate: "collaborator", mentor: "mentor" };

/** A startup: what it is, its team, and for founders the requests and people matching what they need. */
export default async function StartupPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireOwner();
  const { slug } = await params;
  const s = await getStartup(user, decodeURIComponent(slug)).catch((err) => {
    if (err instanceof SocialError) return null;
    throw err;
  });
  if (!s) notFound();
  const [requests, matches] = s.canManage ? await Promise.all([listInterests(user, s.id), matchPeople(user, s.id)]) : [[], []];

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3">
      <Link href="/startups" className="text-[13px] text-muted hover:text-foreground">
        Startups
      </Link>
      <header className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-5">
        <div>
          <h1 className="font-serif text-[26px] leading-tight">{s.name}</h1>
          <p className="mt-1 text-[15px]">{s.oneLiner}</p>
          <p className="mt-1 text-[13px] text-muted">
            {STAGE[s.stage] ?? s.stage}
            {s.industry ? ` · ${s.industry}` : ""}
            {s.visibility === "private" ? " · Private" : ""}
            {s.archived ? " · Archived" : ""}
          </p>
        </div>
        {s.description ? <p className="whitespace-pre-wrap text-[14px] leading-6">{s.description}</p> : null}
        {s.lookingFor.length ? <p className="text-[13px]"><span className="text-muted">Looking for:</span> {s.lookingFor.join(", ")}</p> : null}
        {s.skillsNeeded.length ? <p className="text-[13px]"><span className="text-muted">Skills needed:</span> {s.skillsNeeded.join(", ")}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {s.myRole ? (
            s.spaceSlug ? (
              <Link href={`/s/${s.spaceSlug}`} className="inline-flex h-9 items-center rounded-[10px] bg-primary px-3 text-[14px] text-primary-foreground">
                Open the team Space
              </Link>
            ) : null
          ) : s.archived ? null : (
            <InterestButton startupId={s.id} pending={Boolean(s.myInterest)} />
          )}
        </div>
      </header>

      <section aria-label="Team" className="card rounded-[14px] border border-border bg-background p-4">
        <h2 className="text-[14px] font-medium">Team</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-[14px]">
          {s.members.map((m) => (
            <li key={m.userId}>
              <Link href={`/u/${m.handle}`} className="font-medium">
                {m.name}
              </Link>{" "}
              <span className="text-muted">{ROLE[m.role] ?? m.role}</span>
            </li>
          ))}
        </ul>
      </section>

      {s.canManage ? (
        <>
          <section aria-label="Requests to join" className="card rounded-[14px] border border-border bg-background p-4">
            <h2 className="text-[14px] font-medium">Requests to join</h2>
            {requests.length ? (
              <ul className="mt-2 flex flex-col gap-3">
                {requests.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 text-[14px]">
                    <span>
                      <Link href={`/u/${r.handle}`} className="font-medium">
                        {r.name}
                      </Link>{" "}
                      <span className="text-muted">as a {KIND[r.kind] ?? r.kind}</span>
                    </span>
                    {r.headline ? <span className="text-[13px] text-muted">{r.headline}</span> : null}
                    {r.message ? <span className="whitespace-pre-wrap text-[13px]">{r.message}</span> : null}
                    <AnswerInterest interestId={r.id} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[13px] text-muted">No requests waiting.</p>
            )}
          </section>
          <section aria-label="People who match" className="card rounded-[14px] border border-border bg-background p-4">
            <h2 className="text-[14px] font-medium">People with the skills you need</h2>
            {matches.length ? (
              <ul className="mt-2 flex flex-col gap-2 text-[14px]">
                {matches.map((p) => (
                  <li key={p.userId}>
                    <Link href={`/u/${p.handle}`} className="font-medium">
                      {p.name}
                    </Link>{" "}
                    <span className="text-muted">{p.headline}</span>
                    <span className="block text-[12px] text-subtle">Matches {p.matched.join(", ")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[13px] text-muted">{s.skillsNeeded.length ? "Nobody open to joining has those skills on their profile yet." : "Add the skills you need to see people who have them."}</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
