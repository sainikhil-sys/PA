import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FollowButton } from "@/components/feed/follow-button";
import { type FeedPost, PostCard } from "@/components/feed/post-card";
import { Avatar } from "@/components/ui/misc";
import { requireOwner } from "@/lib/auth/session";
import { profilePosts } from "@/lib/feed/posts";
import { profileView } from "@/lib/feed/profiles";
import { proProfileFor, requireNetwork } from "@/lib/startups/service";
import { SocialError } from "@/lib/social/service";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

/** Someone's profile: name, handle, follower counts, and the posts you're allowed to see. */
export default async function ProfilePage({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const user = await requireOwner();
  const [{ handle }, sp] = await Promise.all([params, searchParams]);
  const profile = await profileView(user.id, decodeURIComponent(handle)).catch((err) => {
    if (err instanceof SocialError) return null;
    throw err;
  });
  if (!profile) notFound();
  const posts = profile.canSeePosts ? await profilePosts(user.id, profile.id, sp.cursor) : { items: [], next: null };
  // The professional profile, when the startup network is on and they show it to this viewer.
  const pro = await requireNetwork(user)
    .then(() => proProfileFor(user.id, profile.id))
    .catch(() => null);

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <header className="card flex items-center gap-4 rounded-[14px] border border-border bg-background p-5">
        <Avatar src={profile.avatarUrl} name={profile.name} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-[24px] leading-tight">{profile.name}</h1>
          <p className="truncate text-[13px] text-muted">
            @{profile.handle}
            {profile.privateAccount ? " · private account" : ""}
            {profile.friends ? " · friends in Chats" : ""}
          </p>
          <p className="mt-1 text-[13px]">
            <span className="tabular font-medium">{profile.followers}</span> <span className="text-muted">followers</span> · <span className="tabular font-medium">{profile.following}</span>{" "}
            <span className="text-muted">following</span>
          </p>
        </div>
        {profile.blocked ? <span className="text-[13px] text-muted">Blocked</span> : <FollowButton userId={profile.id} initial={profile.followState} />}
      </header>
      {pro && (pro.headline || pro.skills.length || pro.about) ? (
        <section aria-label="Professional profile" className="card flex flex-col gap-1.5 rounded-[14px] border border-border bg-background p-4 text-[14px]">
          {pro.headline ? <p className="font-medium">{pro.headline}</p> : null}
          {pro.about ? <p className="whitespace-pre-wrap leading-6 text-muted">{pro.about}</p> : null}
          {pro.skills.length ? <p className="text-[13px]"><span className="text-muted">Skills:</span> {pro.skills.join(", ")}</p> : null}
          {pro.location ? <p className="text-[13px] text-muted">{pro.location}</p> : null}
        </section>
      ) : null}
      {!profile.canSeePosts ? (
        <p className="rounded-[14px] border border-border p-4 text-[14px] text-muted">
          {profile.blocked ? "You blocked this person. Unblock them in Chats to see their posts." : "This account is private. Follow to ask to see their posts."}
        </p>
      ) : posts.items.length ? (
        (posts.items as FeedPost[]).map((p) => <PostCard key={p.id} post={p} />)
      ) : (
        <p className="rounded-[14px] border border-border p-4 text-[14px] text-muted">No posts to show yet.</p>
      )}
      {posts.next ? (
        <Link href={`/u/${profile.handle}?cursor=${posts.next}`} className="self-center py-2 text-[14px] text-muted underline hover:text-foreground">
          Older posts
        </Link>
      ) : null}
    </div>
  );
}
