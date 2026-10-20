"use client";

import { ArrowClockwise, ArrowSquareOut, Books, FileArrowUp, Globe, MagnifyingGlass, NotePencil, Plus, Trash } from "@phosphor-icons/react";
import { motion, useReducedMotionConfig } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { addPastedText, addSource, addUrl, deleteItem, deleteSyncedData, removeSource, syncSourceNow, toggleSourceIncluded } from "@/app/actions/knowledge";
import { BrandLogo } from "@/components/integrations/brand-logo";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Textarea, inputClass } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { EmptyState } from "@/components/ui/states";
import { fetcher } from "@/lib/fetcher";
import { cn, timeAgo } from "@/lib/utils";

export type SourceCard = { id: string; type: string; name: string; included: boolean; status: string; itemCount: number; lastSyncAt: string | null; lastError: string | null; config: Record<string, unknown> };

const LOGO: Record<string, string | null> = { drive: "googledrive", gmail: "gmail", notion: "notion", slack: "slack", github: "github", upload: null, text: null, url: null };
const PICK: Record<string, { label: string; hint: string; needs: string }> = {
  drive: { label: "Folder IDs", hint: "Paste folder IDs from the Drive URL (…/folders/<ID>), comma separated. Docs, Sheets, PDFs and text files inside are indexed.", needs: "google" },
  gmail: { label: "Label IDs (optional)", hint: "Leave empty for all classified mail. Only subjects and AI summaries are indexed, never full bodies.", needs: "google" },
  notion: { label: "Page IDs (optional)", hint: "Leave empty to index every page shared with your integration.", needs: "notion" },
  slack: { label: "Channel IDs", hint: "e.g. C0123ABC. Invite the bot to each channel first.", needs: "slack" },
  github: { label: "Repositories", hint: "owner/repo, comma separated. READMEs and docs/*.md are indexed.", needs: "github" },
};

export function KnowledgePage({ sources, connected }: { sources: SourceCard[]; connected: Record<string, boolean> }) {
  const router = useRouter();
  const reduce = useReducedMotionConfig();
  const [pending, start] = React.useTransition();
  const [adding, setAdding] = React.useState<string | null>(null);
  const [selection, setSelection] = React.useState("");
  const [paste, setPaste] = React.useState(false);
  const [url, setUrl] = React.useState(false);
  const [confirm, setConfirm] = React.useState<SourceCard | null>(null);
  const [q, setQ] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const { data: items, mutate } = useSWR<{ items: { id: string; title: string; url: string | null; chars: number; sourceId: string; updatedAt: string }[] }>(`/api/knowledge/items?q=${encodeURIComponent(q)}`, fetcher, { refreshInterval: 15_000 });
  const byId = new Map(sources.map((s) => [s.id, s]));

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      if (ok) toast.success(ok);
      router.refresh();
      void mutate();
    });

  const upload = async (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/knowledge/upload", { method: "POST", body: fd });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) return void toast.error(data.error ?? "Upload failed");
    toast.success("Added to your knowledge base");
    router.refresh();
    void mutate();
  };

  const available = (["drive", "gmail", "notion", "slack", "github"] as const).filter((t) => !sources.some((s) => s.type === t));

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="sources">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="sources" className="text-[15px] font-medium">
            Sources
          </h2>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.txt,.md" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <FileArrowUp /> Upload file
            </Button>
            <Button size="sm" onClick={() => setPaste(true)}>
              <NotePencil /> Paste text
            </Button>
            <Button size="sm" onClick={() => setUrl(true)}>
              <Globe /> Add web page
            </Button>
          </div>
        </div>
        {sources.length === 0 ? (
          <Card>
            <EmptyState icon={Books} title="Your knowledge base is empty" description="Connect Drive, Notion or GitHub, or upload a document. Your agent answers from what's here, with citations." />
          </Card>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sources.map((s, i) => (
              <motion.li key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: reduce ? 0 : Math.min(i, 6) * 0.03 }}>
                <Card className="flex h-full flex-col gap-4 p-5">
                  <div className="flex items-start gap-3">
                    {LOGO[s.type] ? <BrandLogo id={LOGO[s.type]!} size={22} box /> : <span className="grid size-[42px] place-items-center rounded-[12px] border border-border text-muted">{s.type === "url" ? <Globe size={20} /> : s.type === "upload" ? <FileArrowUp size={20} /> : <NotePencil size={20} />}</span>}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
                        <StatusDot state={s.status === "error" ? "error" : s.status === "syncing" ? "warn" : s.included ? "ok" : "idle"} />
                        {s.status === "error" ? "Needs attention" : s.status === "syncing" ? "Syncing…" : s.included ? "Included" : "Excluded"}
                      </p>
                    </div>
                    <Switch checked={s.included} aria-label={`Include ${s.name} in answers`} onCheckedChange={(v) => act(() => toggleSourceIncluded({ id: s.id, included: v }))} />
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-[12px]">
                    <div>
                      <dt className="text-muted">Items</dt>
                      <dd className="tabular text-sm">{s.itemCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Last sync</dt>
                      <dd className="text-sm">{s.lastSyncAt ? timeAgo(s.lastSyncAt) : "Never"}</dd>
                    </div>
                  </dl>
                  {s.lastError ? <p className="text-[12px] text-danger">{s.lastError}</p> : null}
                  <div className="mt-auto flex flex-wrap gap-2">
                    {PICK[s.type] ? (
                      <Button size="sm" disabled={pending} onClick={() => act(() => syncSourceNow({ id: s.id }), "Synced")}>
                        <ArrowClockwise /> Sync now
                      </Button>
                    ) : null}
                    {PICK[s.type] ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelection(Object.values(s.config).flat().join(", "));
                          setAdding(s.type);
                        }}
                      >
                        Choose
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(s)}>
                      <Trash /> Delete data
                    </Button>
                  </div>
                </Card>
              </motion.li>
            ))}
          </ul>
        )}
        {available.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {available.map((t) => (
              <Button
                key={t}
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSelection("");
                  setAdding(t);
                }}
              >
                <Plus /> <BrandLogo id={LOGO[t]!} size={16} /> {t === "drive" ? "Google Drive" : t[0]!.toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="items">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="items" className="text-[15px] font-medium">
            Items
          </h2>
          <div className="relative w-full sm:w-72">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles" aria-label="Search items" className={cn(inputClass, "h-10 pl-9 text-sm")} />
          </div>
        </div>
        {!items?.items.length ? (
          <p className="rounded-[16px] border border-dashed border-border-strong px-4 py-8 text-center text-[13px] text-muted">{q ? "Nothing matches." : "Indexed documents will appear here."}</p>
        ) : (
          <ul className="divide-y divide-border rounded-[16px] border border-border">
            {items.items.map((it) => (
              <li key={it.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                {LOGO[byId.get(it.sourceId)?.type ?? ""] ? <BrandLogo id={LOGO[byId.get(it.sourceId)!.type]!} size={16} /> : <Books size={16} className="text-muted" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{it.title}</p>
                  <p className="text-[12px] text-muted">
                    <span className="tabular">{Math.round(it.chars / 1000)}k chars</span> · {timeAgo(it.updatedAt)}
                  </p>
                </div>
                {it.url ? (
                  <a href={it.url} target={it.url.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer nofollow" className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-hover" aria-label={`Open ${it.title}`}>
                    <ArrowSquareOut size={16} />
                  </a>
                ) : null}
                <button type="button" onClick={() => act(() => deleteItem({ id: it.id }), "Removed")} className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface-hover" aria-label={`Remove ${it.title}`}>
                  <Trash size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
        title={adding ? `Choose what to index from ${adding === "drive" ? "Google Drive" : adding}` : ""}
        description="Read-only. Synced content is treated as data and never as instructions."
        footer={
          adding && PICK[adding] && !connected[PICK[adding]!.needs] ? (
            <Button asChild variant="primary">
              <Link href="/integrations">Connect first</Link>
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                act(async () => {
                  const r = await addSource({ type: adding as "drive", selection });
                  if (r.ok) {
                    setAdding(null);
                    void syncSourceNow({ id: r.data.id }).then(() => router.refresh());
                  }
                  return r;
                }, "Source saved. First sync started.")
              }
            >
              Save & sync
            </Button>
          )
        }
      >
        {adding && PICK[adding] ? (
          <div className="flex flex-col gap-2">
            {!connected[PICK[adding]!.needs] ? <p className="mb-2 text-[13px] text-muted">Connect {PICK[adding]!.needs === "google" ? "Google" : PICK[adding]!.needs} on the Integrations page first.</p> : null}
            <Label htmlFor="k-sel">{PICK[adding]!.label}</Label>
            <Input id="k-sel" value={selection} onChange={(e) => setSelection(e.target.value)} />
            <FieldHint>{PICK[adding]!.hint}</FieldHint>
          </div>
        ) : null}
      </Dialog>

      <PasteDialog open={paste} onOpenChange={setPaste} onDone={() => (router.refresh(), void mutate())} />
      <UrlDialog open={url} onOpenChange={setUrl} onDone={() => (router.refresh(), void mutate())} />

      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete synced data from ${confirm?.name}?`}
        description="All indexed items and their embeddings for this source are removed from Cowork. Nothing is deleted at the source."
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            {confirm && !PICK[confirm.type] ? (
              <Button variant="primary" onClick={() => act(async () => { const r = await removeSource({ id: confirm.id }); setConfirm(null); return r; }, "Removed")}>
                Delete
              </Button>
            ) : (
              <Button variant="primary" onClick={() => confirm && act(async () => { const r = await deleteSyncedData({ id: confirm.id }); setConfirm(null); return r; }, "Synced data deleted")}>
                Delete data
              </Button>
            )}
          </>
        }
      >
        {null}
      </Dialog>
    </div>
  );
}

function PasteDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [pending, start] = React.useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Paste text"
      footer={
        <Button
          variant="primary"
          disabled={pending || !title.trim() || !content.trim()}
          onClick={() =>
            start(async () => {
              const r = await addPastedText({ title, content });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Added");
              setTitle("");
              setContent("");
              onOpenChange(false);
              onDone();
            })
          }
        >
          Add
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Input aria-label="Title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea aria-label="Content" placeholder="Paste notes, a transcript, anything…" value={content} onChange={(e) => setContent(e.target.value)} className="min-h-48" data-lenis-prevent />
      </div>
    </Dialog>
  );
}

function UrlDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [value, setValue] = React.useState("");
  const [pending, start] = React.useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a web page"
      description="The page's text is indexed. Only public pages can be fetched."
      footer={
        <Button
          variant="primary"
          disabled={pending || !value}
          onClick={() =>
            start(async () => {
              const r = await addUrl({ url: value });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Page added");
              setValue("");
              onOpenChange(false);
              onDone();
            })
          }
        >
          {pending ? "Fetching…" : "Add"}
        </Button>
      }
    >
      <Input aria-label="URL" type="url" placeholder="https://…" value={value} onChange={(e) => setValue(e.target.value)} />
    </Dialog>
  );
}
