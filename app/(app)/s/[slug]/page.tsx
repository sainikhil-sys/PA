import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type FeedPost, PostCard } from "@/components/feed/post-card";
import { InviteLink, JoinButton, RequestActions, Rsvp, SpaceComposer } from "@/components/spaces/space-actions";
import { requireOwner } from "@/lib/auth/session";
import { getSpace, listEvents, listMembers, spacePosts } from "@/lib/spaces/service";
import { SocialError } from "@/lib/social/service";

export const metadata: Metadata = { title: "Space" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** A Space: about and rules, upcoming events, join requests for moderators, and its posts. */
export default async function SpacePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const user = await requireOwner();
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const space = await getSpace(user, decodeURIComponent(slug)).catch((err) => {
    if (err instanceof SocialError) return null;
    throw err;
  });
  if (!space) notFound();
  const [posts, events, requests] = await Promise.all([
    spacePosts(user, space.id, sp.cursor),
    listEvents(user, space.id),
    space.canModerate ? listMembers(user, space.id, "requested") : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3">
      <Link href="/spaces" className="text-[13px] text-muted hover:text-foreground">
        All Spaces
      </Link>
      <header className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-[26px] leading-tight">{space.name}</h1>
            <p className="mt-1 text-[13px] text-muted">
              {space.memberCount} {space.memberCount === 1 ? "member" : "members"} · {space.visibility === "private" ? "Members only" : "Public"}
              {space.audience === "adults" ? " · 18+" : ""}
              {space.archived ? " · Read only" : ""}
              {space.myRole && space.myRole !== "member" ? ` · You're ${space.myRole === "owner" ? "an owner" : "a moderator"}` : ""}
            </p>
          </div>
          {space.myRole === "owner" ? null : <JoinButton spaceId={space.id} status={space.myStatus === "banned" ? null : space.myStatus} joinPolicy={space.joinPolicy} />}
        </div>
        {space.description ? <p className="whitespace-pre-wrap text-[14px] leading-6">{space.description}</p> : null}
        {space.rules ? (
          <details className="text-[14px]">
            <summary className="cursor-pointer text-muted">Rules</summary>
            <p className="mt-2 whitespace-pre-wrap leading-6">{space.rules}</p>
          </details>
        ) : null}
        {space.canModerate ? <InviteLink spaceId={space.id} /> : null}
      </header>

      {requests.length ? (
        <section aria-label="Join requests" className="card rounded-[14px] border border-border bg-background p-4">
          <h2 className="text-[14px] font-medium">Asking to join</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {requests.map((r) => (
              <li key={r.userId} className="flex items-center justify-between gap-2 text-[14px]">
                <Link href={`/u/${r.handle}`} className="min-w-0 truncate">
                  {r.name} <span className="text-muted">@{r.handle}</span>
                </Link>
                <RequestActions spaceId={space.id} userId={r.userId} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {events.length ? (
        <section aria-label="Upcoming events" className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
          <h2 className="text-[14px] font-medium">Upcoming</h2>
          {events.map((ev) => (
            <div key={ev.id} className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[14px] font-medium">
                  {ev.title}
                  {ev.cancelled ? <span className="font-normal text-muted"> (cancelled)</span> : null}
                </p>
                <p className="text-[12px] text-muted">
                  {when(ev.startsAt)}
                  {ev.location ? ` · ${ev.location}` : ""} · {ev.going} going
                </p>
              </div>
              {space.myStatus === "active" && !ev.cancelled ? <Rsvp eventId={ev.id} current={ev.myRsvp} /> : null}
            </div>
          ))}
        </section>
      ) : null}

      {space.canPost && !sp.cursor ? <SpaceComposer spaceId={space.id} canAnnounce={space.canModerate} /> : null}
      {!space.canRead ? (
        <p className="rounded-[14px] border border-border p-4 text-[14px] text-muted">
          {space.myStatus === "requested" ? "Your request to join is waiting for a moderator." : "Join this Space to read its posts."}
        </p>
      ) : null}
      {[...posts.pinned, ...posts.items].map((p) => (
        <PostCard key={p.id} post={p as FeedPost} canModerate={space.canModerate} />
      ))}
      {space.canRead && !posts.pinned.length && !posts.items.length ? <p className="rounded-[14px] border border-border p-4 text-[14px] text-muted">No posts yet.</p> : null}
      {posts.next ? (
        <Link href={`/s/${space.slug}?cursor=${posts.next}`} className="self-center py-2 text-[14px] text-muted underline hover:text-foreground">
          Older posts
        </Link>
      ) : null}
    </div>
  );
}
