"use client";

import { BookmarkSimple, ChatCircle, Heart } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/misc";
import { cn, timeAgo } from "@/lib/utils";
import { call } from "./api";

export type FeedPost = {
  id: string;
  author: { id: string; handle: string; name: string; avatarUrl: string | null };
  body: string;
  visibility: "public" | "followers" | "friends";
  status: "published" | "held" | "removed";
  media: { id: string; kind: string; url: string | null; width: number | null; height: number | null }[];
  commentCount: number;
  reactionCount: number;
  myReactions: string[];
  saved: boolean;
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
};

const AUDIENCE = { public: "Everyone", followers: "Followers", friends: "Friends" } as const;

/** One post: author, text, photos, and like / comment / save, plus hide, report or delete. */
export function PostCard({ post, linkToPost = true }: { post: FeedPost; linkToPost?: boolean }) {
  const router = useRouter();
  const [liked, setLiked] = React.useState(post.myReactions.includes("like"));
  const [likes, setLikes] = React.useState(post.reactionCount);
  const [saved, setSaved] = React.useState(post.saved);
  const [gone, setGone] = React.useState(false);
  const [pending, start] = React.useTransition();

  if (gone) return null;

  const like = () =>
    start(async () => {
      const r = await call<{ added: boolean }>(`/api/posts/${post.id}/reactions`, { body: { kind: "like" } });
      if (!r.ok) return void toast.error(r.error);
      setLiked(r.data.added);
      setLikes((n) => Math.max(0, n + (r.data.added ? 1 : -1)));
    });
  const save = () =>
    start(async () => {
      const r = await call<{ saved: boolean }>(`/api/posts/${post.id}/save`);
      if (!r.ok) return void toast.error(r.error);
      setSaved(r.data.saved);
      toast.success(r.data.saved ? "Saved" : "Removed from saved");
    });
  const hide = () =>
    start(async () => {
      const r = await call(`/api/posts/${post.id}/hide`);
      if (!r.ok) return void toast.error(r.error);
      setGone(true);
      toast.success("You won't see this post again");
    });
  const report = () =>
    start(async () => {
      if (!window.confirm("Report this post? An admin will review it.")) return;
      const r = await call("/api/feed/reports", { body: { postId: post.id, reason: "other" } });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Reported. Thank you.");
    });
  const remove = () =>
    start(async () => {
      if (!window.confirm("Delete this post? This can't be undone.")) return;
      const r = await call(`/api/posts/${post.id}`, { method: "DELETE" });
      if (!r.ok) return void toast.error(r.error);
      setGone(true);
      router.refresh();
    });

  return (
    <article className="card rounded-[14px] border border-border bg-background p-4">
      <header className="flex items-center gap-3">
        <Link href={`/u/${post.author.handle}`} className="flex min-w-0 items-center gap-3">
          <Avatar src={post.author.avatarUrl} name={post.author.name} size={36} />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium">{post.author.name}</span>
            <span className="block truncate text-[12px] text-muted">
              @{post.author.handle} · {timeAgo(post.createdAt)}
              {post.editedAt ? " · edited" : ""} · {AUDIENCE[post.visibility]}
            </span>
          </span>
        </Link>
      </header>
      {post.status === "held" ? (
        <p className="mt-3 rounded-[10px] bg-surface px-3 py-2 text-[13px] text-muted">This post is being reviewed. Only you can see it until then.</p>
      ) : null}
      {post.body ? (
        linkToPost ? (
          <Link href={`/p/${post.id}`} className="mt-3 block whitespace-pre-wrap break-words text-[15px] leading-6">
            {post.body}
          </Link>
        ) : (
          <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-6">{post.body}</p>
        )
      ) : null}
      {post.media.length ? (
        <div className={cn("mt-3 grid gap-1.5", post.media.length > 1 && "grid-cols-2")}>
          {post.media.map((m) =>
            m.url && m.kind === "image" ? (
              // Signed, short-lived R2 links: next/image would cache them past expiry.
              // eslint-disable-next-line @next/next/no-img-element
              <img key={m.id} src={m.url} alt="" className="w-full rounded-[10px] border border-border object-cover" loading="lazy" />
            ) : null,
          )}
        </div>
      ) : null}
      <footer className="mt-3 flex flex-wrap items-center gap-1">
        <Button size="sm" variant="quiet" disabled={pending} onClick={like} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"}>
          <Heart weight={liked ? "fill" : "regular"} className={cn(liked && "text-primary-text")} /> <span className="tabular">{likes}</span>
        </Button>
        <Button asChild size="sm" variant="quiet">
          <Link href={`/p/${post.id}`} aria-label="Comments">
            <ChatCircle /> <span className="tabular">{post.commentCount}</span>
          </Link>
        </Button>
        <Button size="sm" variant="quiet" disabled={pending} onClick={save} aria-pressed={saved} aria-label={saved ? "Unsave" : "Save"}>
          <BookmarkSimple weight={saved ? "fill" : "regular"} />
        </Button>
        <span className="ml-auto flex gap-1">
          {post.mine ? (
            <Button size="sm" variant="quiet" disabled={pending} onClick={remove}>
              Delete
            </Button>
          ) : (
            <>
              <Button size="sm" variant="quiet" disabled={pending} onClick={hide}>
                Not interested
              </Button>
              <Button size="sm" variant="quiet" disabled={pending} onClick={report}>
                Report
              </Button>
            </>
          )}
        </span>
      </footer>
    </article>
  );
}
