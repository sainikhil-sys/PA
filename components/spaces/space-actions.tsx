"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { call } from "@/components/feed/api";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Textarea } from "@/components/ui/input";

/** Join, ask to join, cancel a request, or leave. */
export function JoinButton({ spaceId, status, joinPolicy, inviteCode, afterJoinHref }: { spaceId: string; status: "active" | "requested" | null; joinPolicy: string; inviteCode?: string; afterJoinHref?: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const act = (leave: boolean) =>
    start(async () => {
      if (leave && status === "active" && !window.confirm("Leave this Space?")) return;
      const r = await call(leave ? `/api/spaces/${spaceId}/leave` : `/api/spaces/${spaceId}/join`, { body: leave ? undefined : { inviteCode: inviteCode ?? null } });
      if (!r.ok) return void toast.error(r.error);
      if (!leave && afterJoinHref) router.push(afterJoinHref);
      else router.refresh();
    });
  if (status === "active")
    return (
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(true)}>
        Leave
      </Button>
    );
  if (status === "requested")
    return (
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(true)}>
        Cancel request
      </Button>
    );
  if (joinPolicy === "invite" && !inviteCode) return <span className="text-[13px] text-muted">Invite only</span>;
  return (
    <Button size="sm" variant="primary" disabled={pending} onClick={() => act(false)}>
      {joinPolicy === "request" && !inviteCode ? "Ask to join" : "Join"}
    </Button>
  );
}

/** Members write here; owners and moderators can mark a post as an announcement or ask a poll. */
export function SpaceComposer({ spaceId, canAnnounce }: { spaceId: string; canAnnounce: boolean }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [announce, setAnnounce] = React.useState(false);
  const [pollOn, setPollOn] = React.useState(false);
  const [options, setOptions] = React.useState(["", ""]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const post = () =>
    start(async () => {
      setError(null);
      const poll = pollOn ? { options: options.map((o) => o.trim()).filter(Boolean) } : null;
      const r = await call<{ post: { status: string } }>(`/api/spaces/${spaceId}/posts`, { body: { body, kind: announce ? "announcement" : "post", poll } });
      if (!r.ok) return setError(r.error);
      setBody("");
      setPollOn(false);
      setOptions(["", ""]);
      setAnnounce(false);
      toast.success(r.data.post.status === "held" ? "Posted. It's being reviewed and only you can see it for now." : "Posted");
      router.refresh();
    });
  return (
    <div className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
      <label htmlFor="space-compose" className="sr-only">
        Write in this Space
      </label>
      <Textarea id="space-compose" rows={3} maxLength={5000} placeholder={pollOn ? "Ask a question" : "Write something for this Space"} value={body} onChange={(e) => setBody(e.target.value)} />
      {pollOn ? (
        <div className="flex flex-col gap-2">
          {options.map((o, i) => (
            <Input key={i} aria-label={`Option ${i + 1}`} placeholder={`Option ${i + 1}`} maxLength={80} value={o} onChange={(e) => setOptions((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
          {options.length < 6 ? (
            <Button size="sm" variant="ghost" className="self-start" onClick={() => setOptions((all) => [...all, ""])}>
              Add an option
            </Button>
          ) : null}
        </div>
      ) : null}
      <FieldError>{error}</FieldError>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-[13px] text-muted">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={pollOn} onChange={(e) => setPollOn(e.target.checked)} /> Poll
          </label>
          {canAnnounce ? (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Announcement
            </label>
          ) : null}
        </div>
        <Button variant="primary" size="sm" disabled={pending || (!body.trim() && !pollOn)} onClick={post}>
          Post
        </Button>
      </div>
    </div>
  );
}

/** Moderators: make an invite link that works for a week. */
export function InviteLink({ spaceId }: { spaceId: string }) {
  const [link, setLink] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const make = () =>
    start(async () => {
      const r = await call<{ invite: { code: string } }>(`/api/spaces/${spaceId}/invites`, { body: { expiresInHours: 168 } });
      if (!r.ok) return void toast.error(r.error);
      const url = `${window.location.origin}/join/${r.data.invite.code}`;
      setLink(url);
      await navigator.clipboard?.writeText(url).catch(() => {});
      toast.success("Invite link copied. It works for 7 days.");
    });
  return link ? (
    <Input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
  ) : (
    <Button size="sm" variant="secondary" disabled={pending} onClick={make}>
      Invite link
    </Button>
  );
}

/** Going / Maybe / Can't go on an event. */
export function Rsvp({ eventId, current }: { eventId: string; current: string | null }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const set = (status: string) =>
    start(async () => {
      const r = await call(`/api/events/${eventId}/rsvp`, { body: { status } });
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  return (
    <span className="flex gap-1">
      {[
        ["going", "Going"],
        ["maybe", "Maybe"],
        ["not_going", "Can't go"],
      ].map(([v, l]) => (
        <Button key={v} size="sm" variant={current === v ? "primary" : "ghost"} disabled={pending} onClick={() => set(v!)} aria-pressed={current === v}>
          {l}
        </Button>
      ))}
    </span>
  );
}

/** Moderators: accept or decline a request to join. */
export function RequestActions({ spaceId, userId }: { spaceId: string; userId: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const act = (action: "accept" | "decline") =>
    start(async () => {
      const r = await call(`/api/spaces/${spaceId}/members`, { body: { userId, action } });
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  return (
    <span className="flex gap-1.5">
      <Button size="sm" variant="primary" disabled={pending} onClick={() => act("accept")}>
        Accept
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("decline")}>
        Decline
      </Button>
    </span>
  );
}
