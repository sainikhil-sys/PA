"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Textarea } from "@/components/ui/input";
import { timeAgo } from "@/lib/utils";
import { call } from "./api";
import { AuthorLink } from "./post-card";

export type FeedComment = {
  id: string;
  parentId: string | null;
  body: string;
  status: "published" | "held" | "removed";
  author: { id: string | null; handle: string | null; name: string; anonymous?: boolean };
  mine: boolean;
  createdAt: string;
};

/** Comments on a post, replies indented under their comment, and the box to add one. */
export function Comments({ postId, comments, postIsMine }: { postId: string; comments: FeedComment[]; postIsMine: boolean }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [replyTo, setReplyTo] = React.useState<FeedComment | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  const send = () =>
    start(async () => {
      setError(null);
      const r = await call<{ comment: { status: string } }>(`/api/posts/${postId}/comments`, { body: { body, parentId: replyTo?.id ?? null } });
      if (!r.ok) return setError(r.error);
      setBody("");
      setReplyTo(null);
      if (r.data.comment.status === "held") toast.success("Your comment is being reviewed. Only you can see it for now.");
      router.refresh();
    });
  const remove = (id: string) =>
    start(async () => {
      if (!window.confirm("Delete this comment?")) return;
      const r = await call(`/api/comments/${id}`, { method: "DELETE" });
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });

  const top = comments.filter((c) => !c.parentId);
  const replies = (id: string) => comments.filter((c) => c.parentId === id);
  const row = (c: FeedComment, reply = false) => (
    <li key={c.id} className={reply ? "ml-8" : undefined}>
      <p className="text-[13px]">
        <AuthorLink handle={c.author.handle} className="font-medium">
          {c.author.name}
        </AuthorLink>{" "}
        <span className="text-muted">
          {c.author.handle ? `@${c.author.handle}` : "Anonymous"} · {timeAgo(c.createdAt)}
        </span>
      </p>
      <p className="whitespace-pre-wrap break-words text-[14px] leading-6">{c.body}</p>
      {c.status === "held" ? <p className="text-[12px] text-muted">Being reviewed. Only you can see it.</p> : null}
      <div className="flex gap-1">
        {!reply ? (
          <Button size="sm" variant="quiet" onClick={() => setReplyTo(c)}>
            Reply
          </Button>
        ) : null}
        {c.mine || postIsMine ? (
          <Button size="sm" variant="quiet" disabled={pending} onClick={() => remove(c.id)}>
            Delete
          </Button>
        ) : null}
      </div>
    </li>
  );

  return (
    <section aria-label="Comments" className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
      <h2 className="text-[14px] font-medium">Comments</h2>
      {top.length ? (
        <ul className="flex flex-col gap-3">
          {top.map((c) => (
            <React.Fragment key={c.id}>
              {row(c)}
              {replies(c.id).map((r) => row(r, true))}
            </React.Fragment>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">No comments yet.</p>
      )}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {replyTo ? (
          <p className="text-[12px] text-muted">
            Replying to {replyTo.author.handle ? `@${replyTo.author.handle}` : replyTo.author.name}.{" "}
            <button type="button" className="underline" onClick={() => setReplyTo(null)}>
              Cancel
            </button>
          </p>
        ) : null}
        <label htmlFor="comment" className="sr-only">
          Write a comment
        </label>
        <Textarea id="comment" rows={2} maxLength={2000} placeholder="Write a comment" value={body} onChange={(e) => setBody(e.target.value)} />
        <FieldError>{error}</FieldError>
        <Button size="sm" variant="primary" className="self-end" disabled={pending || !body.trim()} onClick={send}>
          Comment
        </Button>
      </div>
    </section>
  );
}
