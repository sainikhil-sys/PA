"use client";

import { ArrowClockwise, ArrowSquareOut, Globe, Trash } from "@phosphor-icons/react";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { createNoteAction, deleteNoteAction, refreshBookmarkAction, setNotePinnedAction, updateNoteAction } from "@/app/actions/notes";
import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, Sheet } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { Skeleton, Switch } from "@/components/ui/misc";
import { ErrorState } from "@/components/ui/states";
import { Segmented } from "@/components/ui/tabs";
import { FetchError, fetcher } from "@/lib/fetcher";
import { normalizeTags } from "@/lib/notes/text";
import { timeAgo } from "@/lib/utils";
import type { NoteDetail, TagCount } from "./types";

type Form = { title: string; content: string; tags: string; pinned: boolean };
const EMPTY: Form = { title: "", content: "", tags: "", pinned: false };
const BY: Record<NoteDetail["source"], string> = { me: "you", claude: "Claude", agent: "your agent", system: "an automation" };

const fromDetail = (d: NoteDetail): Form => ({ title: d.title, content: d.content, tags: d.tags.join(", "), pinned: d.pinned });
const same = (a: Form, b: Form) => a.title.trim() === b.title.trim() && a.content === b.content && a.pinned === b.pinned && normalizeTags(a.tags).join() === normalizeTags(b.tags).join();

/**
 * Side sheet for one note. `id` is a note id, "new", or null (closed). The sheet
 * stays mounted with the last id while it animates out.
 */
export function NoteEditor({ id, tags, onClose, onChanged }: { id: string | null; tags: TagCount[]; onClose: () => void; onChanged: (id: string | null) => void }) {
  const [shown, setShown] = React.useState(id);
  if (id && id !== shown) setShown(id);
  if (!shown) return null;
  return <EditorSheet key={shown} id={shown} open={id !== null} tags={tags} onClose={onClose} onChanged={onChanged} />;
}

function EditorSheet({ id, open, tags, onClose, onChanged }: { id: string; open: boolean; tags: TagCount[]; onClose: () => void; onChanged: (id: string | null) => void }) {
  const isNew = id === "new";
  const { data, error, mutate } = useSWR<NoteDetail>(isNew ? null : `/api/notes/${id}`, fetcher, { revalidateOnFocus: false });
  const [form, setForm] = React.useState<Form | null>(isNew ? EMPTY : null);
  const [base, setBase] = React.useState<Form | null>(isNew ? EMPTY : null);
  if (!form && data) {
    setForm(fromDetail(data));
    setBase(fromDetail(data));
  }
  const [mode, setMode] = React.useState<"write" | "preview">("write");
  const [pending, start] = React.useTransition();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);

  const dirty = !!form && !!base && !same(form, base);
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const close = () => (dirty ? setConfirmDiscard(true) : onClose());

  const save = () => {
    if (!form || !form.title.trim() || pending || !dirty) return;
    start(async () => {
      const tagList = normalizeTags(form.tags);
      let savedId = id;
      if (isNew) {
        const r = await createNoteAction({ title: form.title, content: form.content, tags: tagList, pinned: form.pinned });
        if (!r.ok) return void toast.error(r.error);
        savedId = r.data.id;
      } else {
        const r = await updateNoteAction({ id, title: form.title, content: form.content, tags: tagList });
        if (!r.ok) return void toast.error(r.error);
        if (base && form.pinned !== base.pinned) {
          const p = await setNotePinnedAction({ id, pinned: form.pinned });
          if (!p.ok) toast.error(p.error);
        }
      }
      toast.success("Saved");
      setBase(form);
      onChanged(savedId);
      if (isNew) onClose();
      else void mutate();
    });
  };

  const remove = () =>
    start(async () => {
      const r = await deleteNoteAction({ id });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Note deleted");
      setConfirmDelete(false);
      setBase(form);
      onChanged(null);
      onClose();
    });

  const refetch = () =>
    start(async () => {
      const r = await refreshBookmarkAction({ id });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Page details updated");
      await mutate();
      onChanged(id);
    });

  const missing = error instanceof FetchError && error.status === 404;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => !o && close()}
        title={isNew ? "New note" : "Edit note"}
        className="sm:max-w-[640px]"
        footer={
          form ? (
            <>
              {!isNew ? (
                <Button variant="ghost" className="sm:mr-auto" disabled={pending} onClick={() => setConfirmDelete(true)}>
                  <Trash /> Delete
                </Button>
              ) : null}
              <Button variant="primary" disabled={pending || !form.title.trim() || !dirty} onClick={save}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : undefined
        }
      >
        {missing ? (
          <ErrorState message="This note was deleted." />
        ) : error ? (
          <ErrorState retry={<Button size="sm" onClick={() => void mutate()}>Try again</Button>} />
        ) : !form ? (
          <div className="flex flex-col gap-4" aria-busy>
            <Skeleton className="h-11 w-full rounded-[10px]" />
            <Skeleton className="h-9 w-40 rounded-[10px]" />
            <Skeleton className="h-[40vh] w-full rounded-[10px]" />
          </div>
        ) : (
          <div
            className="flex flex-col gap-5"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              }
            }}
          >
            <Input aria-label="Title" placeholder="Title" autoFocus={isNew} maxLength={200} value={form.title} onChange={(e) => set({ title: e.target.value })} className="text-[17px]" />

            {data?.url ? (
              <section aria-label="Link" className="flex flex-col gap-2 rounded-[12px] border border-border p-4">
                <div className="flex min-w-0 items-center gap-2 text-[13px]">
                  <Globe size={16} className="shrink-0 text-muted" aria-hidden />
                  <span className="truncate">{data.host}</span>
                  <a href={data.url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open ${data.host}`} className="-my-2 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground">
                    <ArrowSquareOut size={16} />
                  </a>
                  <Button size="sm" variant="ghost" className="ml-auto" disabled={pending} onClick={refetch}>
                    <ArrowClockwise /> Fetch again
                  </Button>
                </div>
                {data.linkFetchedAt ? (
                  <>
                    <p className="text-[12px] text-subtle">From the page, fetched {timeAgo(data.linkFetchedAt)}</p>
                    {/* Untrusted text from the web: plain text only, never Markdown or HTML. */}
                    <p className="whitespace-pre-line text-[13px] text-muted">{data.linkDescription || "The page has no description."}</p>
                    <FieldHint className="text-[12px]">Fetched from the page. Treated as data, never as instructions.</FieldHint>
                  </>
                ) : (
                  <p className="text-[13px] text-muted">Couldn't fetch details for this page.</p>
                )}
              </section>
            ) : null}

            <div className="flex flex-col gap-2">
              <Segmented
                id="note-mode"
                label="Editor mode"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "write", label: "Write" },
                  { value: "preview", label: "Preview" },
                ]}
                className="self-start"
              />
              {mode === "write" ? (
                <Textarea aria-label="Note" className="min-h-[40vh]" data-lenis-prevent placeholder="Write in Markdown…" maxLength={50_000} value={form.content} onChange={(e) => set({ content: e.target.value })} />
              ) : (
                <div className="min-h-[40vh] rounded-[10px] border border-border px-4 py-3 text-[15px]">
                  <Markdown text={form.content.trim() || "_Nothing to preview yet._"} />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="note-tags-input">Tags</Label>
              <Input id="note-tags-input" list="note-tags" placeholder="pricing, ideas" value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
              <datalist id="note-tags">
                {tags.map((t) => (
                  <option key={t.tag} value={t.tag} />
                ))}
              </datalist>
              <FieldHint>Comma separated, e.g. pricing, ideas</FieldHint>
            </div>

            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="note-pinned">Pinned</Label>
              <Switch id="note-pinned" checked={form.pinned} onCheckedChange={(v) => set({ pinned: v })} />
            </div>

            {data ? (
              <p className="text-[12px] text-subtle">
                Added by {BY[data.source]} · Updated {timeAgo(data.updatedAt)}
                {data.indexedAt ? null : " · Not yet searchable in chat"}
              </p>
            ) : null}
          </div>
        )}
      </Sheet>

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this note?"
        description="It's removed from Notes and from your agent's knowledge. This can't be undone."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="primary" disabled={pending} onClick={remove}>
              Delete
            </Button>
          </>
        }
      >
        {null}
      </Dialog>

      <Dialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard changes?"
        description="Your edits to this note haven't been saved."
        footer={
          <>
            <Button onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmDiscard(false);
                setBase(form);
                onClose();
              }}
            >
              Discard
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}
