import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NewStartup } from "@/components/startups/forms";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { discoverStartups, findMentors, matchStartups, myProProfile, myStartups, requireNetwork } from "@/lib/startups/service";
import { getProfile, SocialError } from "@/lib/social/service";

export const metadata: Metadata = { title: "Startups" };
export const dynamic = "force-dynamic";

const STAGE: Record<string, string> = { idea: "Idea", prototype: "Prototype", launched: "Launched", revenue: "Earning revenue" };

type Row = { id: string; slug: string; name: string; oneLiner: string; stage: string; industry: string; skillsNeeded: string[]; ownerName: string };

function StartupRow({ s, extra }: { s: Row; extra?: string }) {
  return (
    <li>
      <Link href={`/startups/${s.slug}`} className="card block rounded-[14px] border border-border bg-background p-4 hover:border-border-strong">
        <span className="block text-[15px] font-medium">{s.name}</span>
        <span className="mt-0.5 block text-[14px] text-muted">{s.oneLiner}</span>
        <span className="mt-1 block text-[12px] text-subtle">
          {STAGE[s.stage] ?? s.stage}
          {s.industry ? ` · ${s.industry}` : ""} · by {s.ownerName}
          {extra ? ` · ${extra}` : ""}
        </span>
      </Link>
    </li>
  );
}

/** The startup network: matches for you, your startups, mentors, and everything public. */
export default async function StartupsPage({ searchParams }: { searchParams: Promise<{ q?: string; skill?: string }> }) {
  const user = await requireOwner();
  if (!user.birthDate || !(await getProfile(user.id))) redirect("/feed");
  const gate = await requireNetwork(user).catch((err) => (err instanceof SocialError ? err.message : Promise.reject(err)));
  if (typeof gate === "string")
    return (
      <div className="mx-auto max-w-[720px]">
        <PageHeader title="Startups" />
        <p className="rounded-[14px] border border-border p-4 text-[14px] text-muted">{gate}</p>
      </div>
    );
  const sp = await searchParams;
  const [pro, mine, matches, found, mentors] = await Promise.all([myProProfile(user.id), myStartups(user), matchStartups(user), discoverStartups(user, { q: sp.q, skill: sp.skill }), findMentors(user)]);
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4">
      <PageHeader title="Startups" description="Share an idea, find co-founders and mentors, and build it with a team Space." />
      {!pro?.skills.length ? (
        <p className="rounded-[14px] border border-border p-4 text-[14px] text-muted">
          Add your skills to <Link href="/startups/profile" className="text-foreground underline">your professional profile</Link> to see startups that need them.
        </p>
      ) : (
        <Link href="/startups/profile" className="self-start text-[13px] text-muted underline hover:text-foreground">
          Edit your professional profile
        </Link>
      )}
      <NewStartup />
      {matches.length ? (
        <section aria-label="Matches for you" className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Need your skills</h2>
          <ul className="flex flex-col gap-2">
            {matches.map((s) => (
              <StartupRow key={s.id} s={s} extra={`matches ${s.matched.join(", ")}`} />
            ))}
          </ul>
        </section>
      ) : null}
      {mine.length ? (
        <section aria-label="Your startups" className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Yours</h2>
          <ul className="flex flex-col gap-2">
            {mine.map((s) => (
              <StartupRow key={s.id} s={s} extra={s.myRole} />
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label="Discover" className="flex flex-col gap-2">
        <h2 className="text-[14px] font-medium">Discover</h2>
        <form className="flex gap-2" action="/startups">
          <label htmlFor="sq" className="sr-only">
            Search startups
          </label>
          <input id="sq" name="q" defaultValue={sp.q ?? ""} placeholder="Search by name, idea or industry" className="h-10 flex-1 rounded-[10px] border border-border bg-background px-3 text-[14px]" />
          <button type="submit" className="h-10 rounded-[10px] border border-border px-4 text-[14px]">
            Search
          </button>
        </form>
        {found.items.length ? (
          <ul className="flex flex-col gap-2">
            {found.items.map((s) => (
              <StartupRow key={s.id} s={s} />
            ))}
          </ul>
        ) : (
          <p className="rounded-[14px] border border-border p-4 text-[14px] text-muted">{sp.q ? "No startups match that yet." : "No public startups yet. Share the first one."}</p>
        )}
      </section>
      {mentors.length ? (
        <section aria-label="Mentors" className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Open to mentoring</h2>
          <ul className="flex flex-col gap-2">
            {mentors.map((m) => (
              <li key={m.userId} className="card rounded-[14px] border border-border bg-background p-3 text-[14px]">
                <Link href={`/u/${m.handle}`} className="font-medium">
                  {m.name}
                </Link>{" "}
                <span className="text-muted">{m.headline}</span>
                {m.skills.length ? <span className="mt-1 block text-[12px] text-subtle">{m.skills.join(", ")}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
