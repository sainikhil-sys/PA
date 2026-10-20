"use client";

import { ArrowSquareOut, Globe, PushPin } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn, timeAgo } from "@/lib/utils";
import type { NoteRow } from "./types";

const BY: Partial<Record<NoteRow["source"], string>> = { claude: "Claude", agent: "Agent", system: "Automation" };

/** One note or bookmark. Fetched link text is rendered as plain text, never Markdown or HTML. */
export function NoteCard({ note, onOpen, onTogglePin }: { note: NoteRow; onOpen: () => void; onTogglePin: () => void }) {
  const body = note.excerpt || (note.url ? note.linkDescription : null);
  return (
    <Card className="relative flex h-full flex-col gap-3 p-5 transition-colors hover:border-border-strong">
      <button type="button" onClick={onOpen} className="absolute inset-0 rounded-[16px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20" aria-label={`Open ${note.title}`} />
      <div className="flex items-start gap-2">
        <p className="line-clamp-2 min-w-0 flex-1 pt-0.5 text-sm font-medium">{note.title}</p>
        <button
          type="button"
          onClick={onTogglePin}
          aria-pressed={note.pinned}
          aria-label={note.pinned ? "Unpin note" : "Pin note"}
          className={cn("relative z-10 -mr-2.5 -mt-2.5 grid size-11 shrink-0 place-items-center rounded-full hover:bg-surface-hover", note.pinned ? "text-foreground" : "text-subtle")}
        >
          <PushPin size={18} weight={note.pinned ? "fill" : "regular"} />
        </button>
      </div>
      {note.url && note.host ? (
        <div className="-mt-2 flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <Globe size={14} className="shrink-0" aria-hidden />
          <span className="truncate">{note.host}</span>
          <a
            href={note.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            aria-label={`Open ${note.host}`}
            className="relative z-10 -my-3 grid size-11 shrink-0 place-items-center rounded-full hover:bg-surface-hover hover:text-foreground"
          >
            <ArrowSquareOut size={14} />
          </a>
        </div>
      ) : null}
      {body ? <p className="line-clamp-3 text-[13px] text-muted">{body}</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        {note.tags.slice(0, 3).map((t) => (
          <Badge key={t} variant="soft">
            #{t}
          </Badge>
        ))}
        {note.tags.length > 3 ? <span className="text-[12px] text-subtle">+{note.tags.length - 3}</span> : null}
        {BY[note.source] ? <Badge variant="outline">{BY[note.source]}</Badge> : null}
        <span className="ml-auto text-[12px] text-subtle tabular">{timeAgo(note.updatedAt)}</span>
      </div>
    </Card>
  );
}
