"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Textarea } from "@/components/ui/input";
import { call } from "./api";

const MAX = 5000;
type Visibility = "public" | "followers" | "friends";

/** Write a post. Private accounts (and everyone under 18) can't pick Everyone. */
export function Composer({ privateAccount }: { privateAccount: boolean }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [visibility, setVisibility] = React.useState<Visibility>(privateAccount ? "followers" : "public");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  const post = () =>
    start(async () => {
      setError(null);
      const r = await call<{ post: { status: string } }>("/api/posts", { body: { body, visibility, mediaIds: [] } });
      if (!r.ok) return setError(r.error);
      setBody("");
      toast.success(r.data.post.status === "held" ? "Posted. It's being reviewed and only you can see it for now." : "Posted");
      router.refresh();
    });

  return (
    <div className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
      <label htmlFor="compose" className="sr-only">
        Write a post
      </label>
      <Textarea id="compose" rows={3} maxLength={MAX} placeholder="What's on your mind?" value={body} onChange={(e) => setBody(e.target.value)} />
      <FieldError>{error}</FieldError>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Who can see this
          <select
            className="h-9 rounded-[10px] border border-border bg-background px-2 text-[13px] text-foreground"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility)}
          >
            {privateAccount ? null : <option value="public">Everyone</option>}
            <option value="followers">Followers</option>
            <option value="friends">Friends</option>
          </select>
        </label>
        <div className="flex items-center gap-3">
          <span className="tabular text-[12px] text-subtle">{body.length ? `${body.length}/${MAX}` : ""}</span>
          <Button variant="primary" size="sm" disabled={pending || !body.trim()} onClick={post}>
            Post
          </Button>
        </div>
      </div>
    </div>
  );
}
