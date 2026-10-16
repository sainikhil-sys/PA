"use client";

import { MagnifyingGlass, NotePencil } from "@phosphor-icons/react";
import Link from "next/link";
import * as React from "react";
import useSWR from "swr";
import { inputClass } from "@/components/ui/input";
import { fetcher } from "@/lib/fetcher";
import { cn, timeAgo } from "@/lib/utils";

type Row = { id: string; title: string; updatedAt: string };

export function ConversationList({ activeId }: { activeId?: string }) {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useSWR<{ items: Row[] }>(`/api/chat/conversations${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`, fetcher, { refreshInterval: 15_000 });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-3">
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <label htmlFor="chat-search" className="sr-only">
            Search conversations
          </label>
          <input id="chat-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className={cn(inputClass, "h-10 pl-9 text-sm")} />
        </div>
        <Link href="/chat" className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-border hover:border-border-strong" aria-label="New chat">
          <NotePencil size={18} />
        </Link>
      </div>
      <nav data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Conversations">
        {!data ? (
          <p className="px-3 py-4 text-[13px] text-muted">Loading…</p>
        ) : data.items.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-muted">{debounced ? "No chats match." : "Your conversations will appear here."}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {data.items.map((c) => (
              <li key={c.id}>
                <Link href={`/chat/${c.id}`} aria-current={c.id === activeId ? "page" : undefined} className={cn("flex h-12 flex-col justify-center rounded-[10px] px-3", c.id === activeId ? "bg-surface-2" : "hover:bg-surface-hover")}>
                  <span className="truncate text-sm">{c.title}</span>
                  <span className="text-[11px] text-subtle">{timeAgo(c.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}
