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
  kind?: "post" | "announcement" | "poll";
  pinned?: boolean;
  space?: { id: string; slug: string; name: string } | null;
  poll?: {
    options: { text: string; votes: number; mine: boolean }[];
    multiple: boolean;
    closesAt: string | null;
    closed: boolean;
    total: number;
  } | null;
};

const AUDIENCE = { public: "Everyone", followers: "Followers", friends: "Friends" } as const;

/** One post: author, text, photos, and like / comment / save, plus hide, report or delete. */
export function PostCard({ post, linkToPost = true, canModerate = false }: { post: FeedPost; linkToPost?: boolean; canModerate?: boolean }) {
  const router = useRouter();
  const [liked, setLiked] = React.useState(post.myReactions.includes("like"));
  const [likes, setLikes] = React.useState(post.reactionCount);
  const [saved, setSaved] = React.useState(post.saved);
  const [poll, setPoll] = React.useState(post.poll ?? null);
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
  const vote = (option: number) =>
    start(async () => {
      const r = await call<{ post: FeedPost }>(`/api/posts/${post.id}/vote`, { body: { option } });
      if (!r.ok) return void toast.error(r.error);
      setPoll(r.data.post.poll ?? null);
    });
  const moderate = (action: "pin" | "unpin" | "remove") =>
    start(async () => {
      if (action === "remove" && !window.confirm("Take this post down for everyone in the Space?")) return;
      const r = await call(`/api/posts/${post.id}/moderate`, { body: { action } });
      if (!r.ok) return void toast.error(r.error);
      if (action === "remove") setGone(true);
      router.refresh();
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
              {post.editedAt ? " · edited" : ""} · {post.space ? `in ${post.space.name}` : AUDIENCE[post.visibility]}
            </span>
          </span>
        </Link>
        {post.pinned || post.kind === "announcement" ? (
          <span className="ml-auto shrink-0 rounded-[8px] border border-border px-2 py-0.5 text-[11px] text-muted">{post.kind === "announcement" ? "Announcement" : "Pinned"}</span>
        ) : null}
      </header>
      {post.space && !linkToPost ? (
        <Link href={`/s/${post.space.slug}`} className="mt-2 block text-[12px] text-muted underline">
          {post.space.name}
        </Link>
      ) : null}
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
      {poll ? (
        <div className="mt-3 flex flex-col gap-1.5" role="group" aria-label="Poll">
          {poll.options.map((o, i) => {
            const share = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
            return (
              <button
                key={o.text}
                type="button"
                disabled={pending || poll.closed}
                onClick={() => vote(i)}
                aria-pressed={o.mine}
                className={cn("relative overflow-hidden rounded-[10px] border px-3 py-2 text-left text-[14px]", o.mine ? "border-foreground" : "border-border")}
              >
                <span className="absolute inset-y-0 left-0 bg-surface" style={{ width: `${share}%` }} aria-hidden />
                <span className="relative flex justify-between gap-2">
                  <span>{o.text}</span>
                  <span className="tabular text-muted">{share}%</span>
                </span>
              </button>
            );
          })}
          <p className="text-[12px] text-muted">
            {poll.total} {poll.total === 1 ? "vote" : "votes"}
            {poll.multiple ? " · choose any" : ""}
            {poll.closed ? " · closed" : ""}
          </p>
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
          {canModerate && post.space ? (
            <>
              <Button size="sm" variant="quiet" disabled={pending} onClick={() => moderate(post.pinned ? "unpin" : "pin")}>
                {post.pinned ? "Unpin" : "Pin"}
              </Button>
              {!post.mine ? (
                <Button size="sm" variant="quiet" disabled={pending} onClick={() => moderate("remove")}>
                  Take down
                </Button>
              ) : null}
            </>
          ) : null}
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
