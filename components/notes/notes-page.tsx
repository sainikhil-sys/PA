"use client";

import { BookmarkSimple, MagnifyingGlass, NotePencil, Plus } from "@phosphor-icons/react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { setNotePinnedAction } from "@/app/actions/notes";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Segmented } from "@/components/ui/tabs";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { NoteCard } from "./note-card";
import { NoteEditor } from "./note-editor";
import { SaveLinkDialog } from "./save-link-dialog";
import type { NoteRow, NotesIndexState, TagCount } from "./types";

type Kind = "all" | "notes" | "bookmarks";
type Data = { notes: NoteRow[]; tags: TagCount[] };
const PAGE = 50;

export function NotesPage({ initial, index, openNoteId, openNew, openLink }: { initial: Data; index: NotesIndexState; openNoteId: string | null; openNew: boolean; openLink: boolean }) {
  const router = useRouter();
  const [qInput, setQInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [kind, setKind] = React.useState<Kind>("all");
  const [tag, setTag] = React.useState<string | null>(null);
  const [limit, setLimit] = React.useState(PAGE);
  const [editing, setEditing] = React.useState<string | null>(openNoteId ?? (openNew ? "new" : null));
  const [linkOpen, setLinkOpen] = React.useState(openLink);
  // A link to ?note=<id> while this page is already open (command palette, citation chip).
  const [lastOpenId, setLastOpenId] = React.useState(openNoteId);
  if (openNoteId !== lastOpenId) {
    setLastOpenId(openNoteId);
    if (openNoteId) setEditing(openNoteId);
  }

  React.useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setLimit(PAGE);
    }, 250);
    return () => clearTimeout(t);
  }, [qInput]);

  const filtered = !!q || kind !== "all" || !!tag;
  const key = `/api/notes?q=${encodeURIComponent(q)}&kind=${kind}&tag=${encodeURIComponent(tag ?? "")}&limit=${limit}`;
  const { data, error, mutate } = useSWR<Data>(key, fetcher, { refreshInterval: 15_000, keepPreviousData: true, fallbackData: !filtered && limit === PAGE ? initial : undefined });

  const open = (id: string) => {
    setEditing(id);
    router.replace(`/knowledge/notes?note=${id}`, { scroll: false });
  };
  const close = () => {
    setEditing(null);
    router.replace("/knowledge/notes", { scroll: false });
  };
  const newNote = () => setEditing("new");
  const clearFilters = () => {
    setQInput("");
    setQ("");
    setKind("all");
    setTag(null);
    setLimit(PAGE);
  };

  const togglePin = async (n: NoteRow) => {
    const pinned = !n.pinned;
    await mutate((cur) => cur && { ...cur, notes: cur.notes.map((x) => (x.id === n.id ? { ...x, pinned } : x)) }, { revalidate: false });
    const r = await setNotePinnedAction({ id: n.id, pinned });
    if (!r.ok) toast.error(r.error);
    // Revalidating restores the server's order, and undoes the change if it failed.
    void mutate();
  };

  const notes = data?.notes ?? [];
  const tags = data?.tags ?? initial.tags;
  const pinned = filtered ? [] : notes.filter((n) => n.pinned);
  const rest = pinned.length ? notes.filter((n) => !n.pinned) : notes;

  const grid = (list: NoteRow[]) => (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {list.map((n, i) => (
        <motion.li key={n.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(i, 10) * 0.03 }}>
          <NoteCard note={n} onOpen={() => open(n.id)} onTogglePin={() => void togglePin(n)} />
        </motion.li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
            <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search notes and links" aria-label="Search notes" className={cn(inputClass, "pl-9 text-sm")} />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Segmented
              id="notes-kind"
              label="Show"
              value={kind}
              onChange={(v) => {
                setKind(v);
                setLimit(PAGE);
              }}
              options={[
                { value: "all", label: "All" },
                { value: "notes", label: "Notes" },
                { value: "bookmarks", label: "Links" },
              ]}
            />
            <Button size="sm" className="h-11" onClick={() => setLinkOpen(true)}>
              <BookmarkSimple /> Save link
            </Button>
            <Button size="sm" variant="primary" className="h-11" onClick={newNote}>
              <Plus /> New note
            </Button>
          </div>
        </div>

        {tags.length ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by tag">
            {tags.slice(0, 12).map((t) => (
              <button
                key={t.tag}
                type="button"
                aria-pressed={tag === t.tag}
                onClick={() => {
                  setTag(tag === t.tag ? null : t.tag);
                  setLimit(PAGE);
                }}
                className={cn(
                  "inline-flex h-11 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] transition-colors",
                  tag === t.tag ? "border-foreground bg-surface text-foreground" : "border-border text-muted hover:border-border-strong hover:text-foreground",
                )}
              >
                #{t.tag} <span className="tabular text-subtle">{t.n}</span>
              </button>
            ))}
            {tag ? (
              <Button size="sm" variant="ghost" className="h-11" onClick={() => setTag(null)}>
                Clear
              </Button>
            ) : null}
          </div>
        ) : null}

        <IndexLine index={index} />
      </div>

      {error && !data ? (
        <Card>
          <ErrorState compact retry={<Button size="sm" onClick={() => void mutate()}>Try again</Button>} />
        </Card>
      ) : !data ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-[16px]" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        filtered ? (
          <div className="flex flex-col items-center gap-2 rounded-[16px] border border-dashed border-border-strong px-4 py-8 text-center">
            <p className="text-[13px] text-muted">Nothing matches.</p>
            <Button size="sm" variant="ghost" className="h-11" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={NotePencil}
              title="No notes yet"
              description="Write a note or save a link. Your agent can find them when you ask in chat."
              action={
                <Button size="sm" onClick={newNote}>
                  New note
                </Button>
              }
            />
          </Card>
        )
      ) : (
        <>
          {pinned.length ? (
            <section aria-labelledby="notes-pinned" className="flex flex-col gap-3">
              <h2 id="notes-pinned" className="text-[15px] font-medium">
                Pinned
              </h2>
              {grid(pinned)}
            </section>
          ) : null}
          <section aria-labelledby={pinned.length ? "notes-all" : undefined} className="flex flex-col gap-3">
            {pinned.length ? (
              <h2 id="notes-all" className="text-[15px] font-medium">
                All notes
              </h2>
            ) : null}
            {rest.length ? grid(rest) : <p className="text-[13px] text-muted">Everything here is pinned.</p>}
          </section>
          {notes.length >= limit && limit < 200 ? (
            <Button className="self-center" onClick={() => setLimit((l) => l + PAGE)}>
              Show more
            </Button>
          ) : null}
        </>
      )}

      <NoteEditor id={editing} tags={tags} onClose={close} onChanged={() => void mutate()} />
      <SaveLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onDone={(id) => {
          void mutate();
          open(id);
        }}
      />
    </div>
  );
}

/** Says honestly whether chat can see notes right now. */
function IndexLine({ index }: { index: NotesIndexState }) {
  if (!index.agentCanSearch) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <StatusDot state="idle" /> Knowledge search is off for your agent.
        <Link href="/settings/agent" className="text-foreground underline underline-offset-4">
          Turn it on
        </Link>
      </p>
    );
  }
  if (index.sourceIncluded === false) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <StatusDot state="warn" /> Notes are excluded from chat answers.
        <Link href="/knowledge" className="text-foreground underline underline-offset-4">
          Turn on in Sources
        </Link>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted">
      <StatusDot state="ok" /> Your agent can search these in chat.
    </p>
  );
}
