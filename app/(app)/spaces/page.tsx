import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CreateSpace } from "@/components/spaces/create-space";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { requireSocial } from "@/lib/feed/people";
import { discoverSpaces, mySpaces } from "@/lib/spaces/service";
import { getProfile } from "@/lib/social/service";

export const metadata: Metadata = { title: "Spaces" };
export const dynamic = "force-dynamic";

type Item = Awaited<ReturnType<typeof mySpaces>>[number];

function SpaceRow({ s }: { s: Item }) {
  return (
    <li>
      <Link href={`/s/${s.slug}`} className="card flex items-start justify-between gap-3 rounded-[14px] border border-border bg-background p-4 hover:border-border-strong">
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium">{s.name}</span>
          {s.description ? <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{s.description}</span> : null}
          <span className="mt-1 block text-[12px] text-subtle">
            {s.memberCount} {s.memberCount === 1 ? "member" : "members"} · {s.visibility === "private" ? "Members only" : "Public"}
            {s.audience === "adults" ? " · 18+" : ""}
            {s.archived ? " · Read only" : ""}
          </span>
        </span>
        {s.myStatus === "requested" ? <span className="shrink-0 text-[12px] text-muted">Requested</span> : s.myRole ? <span className="shrink-0 text-[12px] text-muted">{s.myRole === "member" ? "Joined" : s.myRole}</span> : null}
      </Link>
    </li>
  );
}

/** Spaces you're in, and public Spaces to discover (search and category). */
export default async function SpacesPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const user = await requireOwner();
  if (!user.birthDate || !(await getProfile(user.id))) redirect("/feed");
  const me = await requireSocial(user);
  const sp = await searchParams;
  const [mine, found] = await Promise.all([mySpaces(user), discoverSpaces(user, { q: sp.q, category: sp.category })]);
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4">
      <PageHeader title="Spaces" description="Communities for what you study, build, play or care about." />
      <CreateSpace teen={me.group === "teen"} />
      {mine.length ? (
        <section aria-label="Your Spaces" className="flex flex-col gap-2">
          <h2 className="text-[14px] font-medium">Your Spaces</h2>
          <ul className="flex flex-col gap-2">
            {mine.map((s) => (
              <SpaceRow key={s.id} s={s} />
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label="Discover" className="flex flex-col gap-2">
        <h2 className="text-[14px] font-medium">Discover</h2>
        <form className="flex gap-2" action="/spaces">
          <label htmlFor="q" className="sr-only">
            Search Spaces
          </label>
          <input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Search by name or topic" className="h-10 flex-1 rounded-[10px] border border-border bg-background px-3 text-[14px]" />
          <button type="submit" className="h-10 rounded-[10px] border border-border px-4 text-[14px]">
            Search
          </button>
        </form>
        {found.items.length ? (
          <ul className="flex flex-col gap-2">
            {found.items.map((s) => (
              <SpaceRow key={s.id} s={s} />
            ))}
          </ul>
        ) : (
          <p className="rounded-[14px] border border-border p-4 text-[14px] text-muted">{sp.q ? "No public Spaces match that yet." : "No public Spaces yet. Create the first one."}</p>
        )}
      </section>
    </div>
  );
}
