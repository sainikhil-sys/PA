import type { Metadata } from "next";
import Link from "next/link";
import { Composer } from "@/components/feed/composer";
import { FollowRequestActions } from "@/components/feed/follow-button";
import { type FeedPost, PostCard } from "@/components/feed/post-card";
import { FeedSetup } from "@/components/feed/setup";
import { MomentsTray } from "@/components/moments/moments";
import { PageHeader } from "@/components/ui/states";
import { requireOwner } from "@/lib/auth/session";
import { requireSocial } from "@/lib/feed/people";
import { followingFeed, forYouFeed, savedFeed } from "@/lib/feed/posts";
import { listFollowRequests } from "@/lib/feed/profiles";
import { tray } from "@/lib/moments/service";
import { suggestHandle } from "@/lib/social/rules";
import { getProfile } from "@/lib/social/service";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Feed" };
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TABS = [
  { id: "following", label: "Following" },
  { id: "foryou", label: "For you" },
  { id: "saved", label: "Saved" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ tab?: string; cursor?: string }> }) {
  const user = await requireOwner();
  const sp = await searchParams;
  const profile = await getProfile(user.id);
  if (!user.birthDate || !profile) {
    return (
      <>
        <PageHeader title="Feed" description="Posts from people you follow, and what's popular on Cowork." />
        <FeedSetup needsBirthDate={!user.birthDate} needsHandle={!profile} suggestion={{ handle: suggestHandle(user.name || user.email), displayName: user.name ?? "" }} />
      </>
    );
  }
  const me = await requireSocial(user);
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "following";
  const load = tab === "foryou" ? forYouFeed : tab === "saved" ? savedFeed : followingFeed;
  const [page, requests, moments] = await Promise.all([load(user.id, sp.cursor), listFollowRequests(user.id), tray(user.id)]);
  const items = page.items as FeedPost[];

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <PageHeader title="Feed" description={`Signed in as @${me.handle}${me.privateAccount ? ", private account" : ""}.`} />
      {!sp.cursor ? <MomentsTray items={moments} canPost /> : null}
      <nav aria-label="Feed" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "following" ? "/feed" : `/feed?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={cn("border-b-2 px-3 py-2.5 text-sm", t.id === tab ? "border-foreground font-medium" : "border-transparent text-muted hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {requests.length ? (
        <section aria-label="Follow requests" className="card rounded-[14px] border border-border bg-background p-4">
          <h2 className="text-[14px] font-medium">Follow requests</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {requests.map((r) => (
              <li key={r.userId} className="flex items-center justify-between gap-2 text-[14px]">
                <Link href={`/u/${r.handle}`} className="min-w-0 truncate">
                  {r.name} <span className="text-muted">@{r.handle}</span>
                </Link>
                <FollowRequestActions userId={r.userId} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {tab !== "saved" && !sp.cursor ? <Composer privateAccount={me.privateAccount} /> : null}
      {items.length ? (
        items.map((p) => <PostCard key={p.id} post={p} />)
      ) : (
        <p className="rounded-[14px] border border-border p-4 text-[14px] text-muted">
          {tab === "saved" ? "Nothing saved yet. Use the bookmark on a post to keep it here." : tab === "foryou" ? "No public posts in the last two weeks yet." : "Nothing here yet. Follow people from their profile, or write the first post."}
        </p>
      )}
      {page.next ? (
        <Link href={`/feed?${new URLSearchParams({ ...(tab === "following" ? {} : { tab }), cursor: page.next })}`} className="self-center py-2 text-[14px] text-muted underline hover:text-foreground">
          Older posts
        </Link>
      ) : null}
    </div>
  );
}
