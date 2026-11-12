import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Comments, type FeedComment } from "@/components/feed/comments";
import { type FeedPost, PostCard } from "@/components/feed/post-card";
import { requireOwner } from "@/lib/auth/session";
import { getPost, listComments } from "@/lib/feed/posts";
import { SocialError } from "@/lib/social/service";

export const metadata: Metadata = { title: "Post" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One post and its comments. Anything you can't see answers "not found", like a post that never existed. */
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOwner();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const loaded = await Promise.all([getPost(user.id, id), listComments(user.id, id)]).catch((err) => {
    if (err instanceof SocialError) return null;
    throw err;
  });
  if (!loaded) notFound();
  const [post, comments] = loaded;
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <Link href="/feed" className="text-[13px] text-muted hover:text-foreground">
        Back to feed
      </Link>
      <PostCard post={post as FeedPost} linkToPost={false} />
      <Comments postId={post.id} comments={comments.items as FeedComment[]} postIsMine={post.mine} />
    </div>
  );
}
