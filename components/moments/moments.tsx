"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { call } from "@/components/feed/api";
import { Button } from "@/components/ui/button";
import { FieldError, Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/misc";
import { cn, timeAgo } from "@/lib/utils";

/** Text-only Moment backgrounds: design tokens, never raw colours. */
export const BACKGROUND_CLASS: Record<string, string> = {
  accent: "bg-primary text-primary-foreground",
  accent2: "bg-accent text-accent-foreground",
  surface: "bg-surface text-foreground",
  text: "bg-foreground text-background",
};

export type TrayItem = { author: { id: string; handle: string; name: string; avatarUrl: string | null }; unseen: number; mine: boolean };

/** The row at the top of the feed: you first, then people with Moments you haven't seen. */
export function MomentsTray({ items, canPost }: { items: TrayItem[]; canPost: boolean }) {
  const [composing, setComposing] = React.useState(false);
  if (!items.length && !canPost) return null;
  return (
    <section aria-label="Moments" className="flex flex-col gap-3">
      <ul className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
        {canPost ? (
          <li>
            <button type="button" onClick={() => setComposing((v) => !v)} className="flex w-16 flex-col items-center gap-1 text-[12px]">
              <span className="grid size-14 place-items-center rounded-full border border-dashed border-border-strong text-[20px] text-muted" aria-hidden>
                +
              </span>
              <span className="w-full truncate text-center">New</span>
            </button>
          </li>
        ) : null}
        {items.map((t) => (
          <li key={t.author.id}>
            <Link href={`/moments/${t.author.id}`} className="flex w-16 flex-col items-center gap-1 text-[12px]" aria-label={`${t.mine ? "Your" : `${t.author.name}'s`} Moments${t.unseen ? ", new" : ""}`}>
              <span className={cn("rounded-full p-[2px]", t.unseen ? "bg-primary" : "bg-border")}>
                <span className="block rounded-full bg-background p-[2px]">
                  <Avatar src={t.author.avatarUrl} name={t.author.name} size={48} />
                </span>
              </span>
              <span className="w-full truncate text-center">{t.mine ? "You" : t.author.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      {composing ? <NewTextMoment onDone={() => setComposing(false)} /> : null}
    </section>
  );
}

/** A text Moment on a colour, for 24 hours. Photos and videos are shared from the app. */
function NewTextMoment({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [background, setBackground] = React.useState("accent");
  const [audience, setAudience] = React.useState("followers");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const share = () =>
    start(async () => {
      setError(null);
      const r = await call<{ moment: { status: string } }>("/api/moments", { body: { body, background, audience } });
      if (!r.ok) return setError(r.error);
      toast.success(r.data.moment.status === "held" ? "Shared. It's being reviewed and only you can see it for now." : "Shared for 24 hours");
      onDone();
      router.refresh();
    });
  return (
    <div className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
      <div className={cn("grid min-h-32 place-items-center rounded-[12px] p-4 text-center text-[18px] leading-7", BACKGROUND_CLASS[background])}>{body || "Your words here"}</div>
      <label htmlFor="moment-text" className="sr-only">
        Moment text
      </label>
      <Textarea id="moment-text" rows={2} maxLength={500} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Say something for the next 24 hours" />
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="text-muted">Colour</span>
        {Object.keys(BACKGROUND_CLASS).map((b) => (
          <button
            key={b}
            type="button"
            aria-label={`Background ${b}`}
            aria-pressed={background === b}
            onClick={() => setBackground(b)}
            className={cn("size-7 rounded-full border", BACKGROUND_CLASS[b], background === b ? "border-foreground ring-2 ring-foreground/30" : "border-border")}
          />
        ))}
        <label className="ml-auto flex items-center gap-2 text-muted">
          Who can see it
          <select className="h-9 rounded-[10px] border border-border bg-background px-2 text-foreground" value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="followers">Followers</option>
            <option value="close_friends">Close friends</option>
          </select>
        </label>
      </div>
      <FieldError>{error}</FieldError>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" disabled={pending || !body.trim()} onClick={share}>
          Share
        </Button>
      </div>
    </div>
  );
}

export type MomentItem = {
  id: string;
  body: string;
  background: string | null;
  status: string;
  media: { kind: string; url: string | null } | null;
  seen: boolean;
  views?: number;
  createdAt: string;
  expiresAt: string;
  mine: boolean;
};

/** Plays one person's Moments in order; marks each as seen; reply, or see views and delete your own. */
export function MomentViewer({ author, items }: { author: { name: string; handle: string; avatarUrl: string | null }; items: MomentItem[] }) {
  const router = useRouter();
  const firstUnseen = Math.max(0, items.findIndex((m) => !m.seen && !m.mine));
  const [i, setI] = React.useState(firstUnseen);
  const [reply, setReply] = React.useState("");
  const [pending, start] = React.useTransition();
  const m = items[i];

  React.useEffect(() => {
    if (m && !m.mine && !m.seen) void call(`/api/moments/${m.id}/view`);
  }, [m]);

  if (!m) return <p className="text-[14px] text-muted">These Moments have ended.</p>;

  const send = () =>
    start(async () => {
      const r = await call(`/api/moments/${m.id}/replies`, { body: { kind: "reply", body: reply } });
      if (!r.ok) return void toast.error(r.error);
      setReply("");
      toast.success("Sent. Only they can see it.");
    });
  const remove = () =>
    start(async () => {
      if (!window.confirm("Delete this Moment?")) return;
      const r = await call(`/api/moments/${m.id}`, { method: "DELETE" });
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1" aria-hidden>
        {items.map((x, j) => (
          <span key={x.id} className={cn("h-1 flex-1 rounded-full", j <= i ? "bg-foreground" : "bg-border")} />
        ))}
      </div>
      <header className="flex items-center gap-3">
        <Avatar src={author.avatarUrl} name={author.name} size={36} />
        <p className="min-w-0 text-[14px]">
          <span className="font-medium">{author.name}</span> <span className="text-muted">@{author.handle} · {timeAgo(m.createdAt)}</span>
        </p>
      </header>
      {m.status === "held" ? <p className="rounded-[10px] bg-surface px-3 py-2 text-[13px] text-muted">This Moment is being reviewed. Only you can see it until then.</p> : null}
      <div className={cn("relative grid min-h-[360px] place-items-center overflow-hidden rounded-[14px] border border-border", m.media ? "bg-surface" : BACKGROUND_CLASS[m.background ?? "accent"])}>
        {m.media?.url && m.media.kind === "image" ? (
          // Signed, short-lived link; next/image would cache it past expiry.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.media.url} alt="" className="max-h-[70vh] w-full object-contain" />
        ) : m.media?.url && m.media.kind === "video" ? (
          <video src={m.media.url} controls playsInline className="max-h-[70vh] w-full" />
        ) : null}
        {m.body ? <p className={cn("whitespace-pre-wrap break-words p-6 text-center", m.media ? "absolute inset-x-0 bottom-0 bg-background/80 text-[15px]" : "text-[20px] leading-8")}>{m.body}</p> : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
          Previous
        </Button>
        {m.mine ? (
          <span className="flex items-center gap-2 text-[13px] text-muted">
            Seen by {m.views ?? 0}
            <Button size="sm" variant="quiet" disabled={pending} onClick={remove}>
              Delete
            </Button>
          </span>
        ) : null}
        <Button size="sm" variant="ghost" disabled={i === items.length - 1} onClick={() => setI(i + 1)}>
          Next
        </Button>
      </div>
      {!m.mine ? (
        <div className="flex gap-2">
          <label htmlFor="moment-reply" className="sr-only">
            Reply
          </label>
          <input
            id="moment-reply"
            value={reply}
            maxLength={1000}
            onChange={(e) => setReply(e.target.value)}
            placeholder={`Reply to ${author.name}`}
            className="h-10 flex-1 rounded-[10px] border border-border bg-background px-3 text-[14px]"
          />
          <Button variant="primary" disabled={pending || !reply.trim()} onClick={send}>
            Send
          </Button>
        </div>
      ) : null}
    </div>
  );
}
