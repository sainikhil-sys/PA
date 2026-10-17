"use client";

import { ArrowSquareOut, Check, Copy, Globe, PaperPlaneTilt, SealCheck } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { approveDraft, markPublished, publishDraftToLinkedIn, saveDraft, scheduleDraft } from "@/app/actions/content";
import { Dialog } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea, inputClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const LIMIT = 3000;
const FOLD = 210;

export function ContentEditor({ draft, author, linkedinConnected }: { draft: { id: string; title: string; body: string; status: string; writtenBy: string; approved: boolean; scheduledFor: string | null }; author: { name: string | null; role: string | null; avatarUrl: string | null; email: string }; linkedinConnected: boolean }) {
  const [confirmPublish, setConfirmPublish] = React.useState(false);
  const router = useRouter();
  const [title, setTitle] = React.useState(draft.title);
  const [body, setBody] = React.useState(draft.body);
  const [saved, setSaved] = React.useState(draft.body);
  const [approved, setApproved] = React.useState(draft.approved);
  const [when, setWhen] = React.useState(draft.scheduledFor ? draft.scheduledFor.slice(0, 16) : "");
  const [expanded, setExpanded] = React.useState(false);
  const [pending, start] = React.useTransition();
  const dirty = body !== saved || title !== draft.title;
  const over = body.length > LIMIT;

  const save = () =>
    start(async () => {
      const res = await saveDraft({ id: draft.id, title, body });
      if (!res.ok) return void toast.error(res.error);
      setSaved(body);
      if (res.data.approvalReset) {
        setApproved(false);
        toast.message("Edited after approval. Approve again before scheduling.");
      } else toast.success("Saved");
      router.refresh();
    });

  // Save on unmount-ish: debounce autosave after 1.5s idle.
  React.useEffect(() => {
    if (!dirty || over) return;
    const t = setTimeout(save, 1500);
    return () => clearTimeout(t);
  }, [body, title]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = expanded || body.length <= FOLD ? body : `${body.slice(0, FOLD).replace(/\s+\S*$/, "")}…`;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {draft.writtenBy !== "me" ? <Badge variant="outline">{draft.writtenBy === "claude" ? "Written by Claude" : "Written by your agent"}</Badge> : null}
          <Badge variant={approved ? "solid" : "dashed"}>
            {approved ? <SealCheck weight="fill" /> : null}
            {approved ? "Approved version" : "Not approved"}
          </Badge>
          <span className="text-[12px] text-muted" aria-live="polite">
            {pending ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="c-title">Title (for you)</Label>
          <Input id="c-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="c-body">Post</Label>
            <span className={cn("tabular text-[12px]", over ? "text-danger" : "text-muted")} aria-live="polite">
              {body.length.toLocaleString()} / {LIMIT.toLocaleString()}
            </span>
          </div>
          <Textarea id="c-body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[420px] text-[15px] leading-relaxed" data-lenis-prevent aria-invalid={over || undefined} />
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <p className="text-[13px] font-medium text-muted">Preview</p>
        <Card className="p-4" aria-label="Post preview">
          <div className="flex items-start gap-3">
            <Avatar src={author.avatarUrl} name={author.name} email={author.email} size={44} />
            <div className="min-w-0">
              <p className="text-sm font-medium">{author.name ?? "You"}</p>
              <p className="truncate text-[12px] text-muted">{author.role ?? "Your headline"}</p>
              <p className="flex items-center gap-1 text-[12px] text-muted">
                now · <Globe size={12} aria-label="Public" />
              </p>
            </div>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-[14px] leading-[1.45]">
            {preview || <span className="text-subtle">Your post will appear here.</span>}
            {body.length > FOLD ? (
              <button type="button" onClick={() => setExpanded((x) => !x)} className="ml-1 text-muted hover:underline">
                {expanded ? "show less" : "…see more"}
              </button>
            ) : null}
          </p>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <p className="text-sm font-medium">Publish</p>
          <p className="text-[13px] text-muted">Approve this exact version, then schedule a reminder or post it yourself. Any edit resets approval.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={approved ? "secondary" : "primary"}
              disabled={pending || dirty || over || approved || !body.trim()}
              onClick={() =>
                start(async () => {
                  const res = await approveDraft({ id: draft.id });
                  if (!res.ok) return void toast.error(res.error);
                  setApproved(true);
                  toast.success("Approved");
                })
              }
            >
              <Check /> {approved ? "Approved" : "Approve this version"}
            </Button>
            <Button
              disabled={!approved || dirty}
              onClick={async () => {
                await navigator.clipboard.writeText(body);
                toast.success("Copied. Paste it into LinkedIn.");
                window.open("https://www.linkedin.com/feed/?shareActive=true", "_blank", "noopener,noreferrer");
              }}
            >
              <Copy /> Copy & open LinkedIn <ArrowSquareOut size={14} />
            </Button>
            {linkedinConnected ? (
              <Button variant="primary" disabled={!approved || dirty || pending || draft.status === "published"} onClick={() => setConfirmPublish(true)}>
                <PaperPlaneTilt /> Publish to LinkedIn
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-when">Schedule a reminder</Label>
              <input id="c-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={cn(inputClass, "w-auto")} disabled={!approved} />
            </div>
            <Button
              disabled={!approved || pending || dirty}
              onClick={() =>
                start(async () => {
                  const res = await scheduleDraft({ id: draft.id, at: when ? new Date(when).toISOString() : null });
                  if (!res.ok) return void toast.error(res.error);
                  toast.success(when ? "Scheduled" : "Unscheduled");
                  router.refresh();
                })
              }
            >
              {when ? "Schedule" : "Clear"}
            </Button>
          </div>
          {approved && draft.status !== "published" ? (
            <Button
              variant="ghost"
              className="w-fit"
              onClick={() =>
                start(async () => {
                  await markPublished({ id: draft.id });
                  toast.success("Marked as published");
                  router.push("/content");
                })
              }
            >
              I posted it
            </Button>
          ) : null}
        </Card>
      </div>
      <Dialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title="Publish to LinkedIn now?"
        description="This posts the approved text below publicly on your LinkedIn profile."
        footer={
          <>
            <Button onClick={() => setConfirmPublish(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await publishDraftToLinkedIn({ id: draft.id, confirm: true });
                  if (!res.ok) return void toast.error(res.error);
                  setConfirmPublish(false);
                  toast.success("Published to LinkedIn", { action: { label: "View", onClick: () => window.open(res.data.url, "_blank", "noopener,noreferrer") } });
                  router.push("/content");
                })
              }
            >
              {pending ? "Publishing…" : "Publish"}
            </Button>
          </>
        }
      >
        <p className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-[10px] bg-surface p-3 text-[13px]" data-lenis-prevent>
          {body}
        </p>
      </Dialog>
    </div>
  );
}
