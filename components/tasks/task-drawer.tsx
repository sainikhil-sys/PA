"use client";

import { ArrowUUpLeft, Check, Plus, Sparkle, Trash } from "@phosphor-icons/react";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  approveTaskAction,
  commentTaskAction,
  createTaskAction,
  deleteTaskAction,
  requestChangesAction,
  toggleTaskDone,
  updateTaskAction,
} from "@/app/actions/tasks";
import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";
import { Dialog, Sheet } from "@/components/ui/dialog";
import { Input, Label, Textarea, inputClass } from "@/components/ui/input";
import { Checkbox, Skeleton } from "@/components/ui/misc";
import { fetcher } from "@/lib/fetcher";
import { cn, timeAgo } from "@/lib/utils";
import { AssigneeBadge, PRIORITY_LABEL, type TaskRow } from "./task-bits";

type Detail = TaskRow & {
  comments: { id: string; author: string; kind: string; body: string; createdAt: string }[];
  subtasks: TaskRow[];
  artifacts: { title: string; url?: string; content?: string }[] | null;
};

export function TaskDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { data, mutate } = useSWR<Detail>(id ? `/api/tasks?id=${id}` : null, fetcher, { refreshInterval: 10_000 });
  const [pending, start] = React.useTransition();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [changeNote, setChangeNote] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [subtask, setSubtask] = React.useState("");

  const refresh = () => {
    void mutate();
    onChanged();
  };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong");
      if (success) toast.success(success);
      refresh();
    });

  const save = (patch: Partial<{ title: string; description: string; dueDate: string | null; priority: number; tags: string[]; assignee: "me" | "agent" | "claude" }>) => run(() => updateTaskAction({ id: id!, ...patch }));

  return (
    <>
      <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()} title={data?.title ?? "Task"} hideTitle={false}>
        {!data ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <AssigneeBadge assignee={data.assignee} status={data.status} />
              <span className="text-[12px] text-muted">Created by {data.createdBy === "me" ? "you" : data.createdBy}</span>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="t-title">Title</Label>
              <Input id="t-title" defaultValue={data.title} key={`t-${data.title}`} onBlur={(e) => e.target.value.trim() && e.target.value !== data.title && save({ title: e.target.value.trim() })} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="t-desc">Notes</Label>
              <Textarea id="t-desc" defaultValue={data.description} key={`d-${data.id}`} onBlur={(e) => e.target.value !== data.description && save({ description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="t-due">Due</Label>
                <input id="t-due" type="date" defaultValue={data.dueDate ?? ""} onChange={(e) => save({ dueDate: e.target.value || null })} className={inputClass} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="t-pri">Priority</Label>
                <select id="t-pri" defaultValue={data.priority} onChange={(e) => save({ priority: Number(e.target.value) })} className={inputClass}>
                  {PRIORITY_LABEL.map((p, i) => (
                    <option key={p} value={i}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="t-asg">Assignee</Label>
                <select id="t-asg" defaultValue={data.assignee} onChange={(e) => save({ assignee: e.target.value as "me" | "agent" | "claude" })} className={inputClass}>
                  <option value="me">Me</option>
                  <option value="agent">Built-in agent</option>
                  <option value="claude">Claude</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="t-tags">Tags</Label>
                <Input id="t-tags" defaultValue={data.tags.join(", ")} placeholder="finance, q4" onBlur={(e) => save({ tags: e.target.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10) })} />
              </div>
            </div>

            {data.resultMarkdown ? (
              <section className="rounded-[14px] border border-border">
                <header className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <Sparkle size={18} className="text-muted" />
                  <h3 className="text-sm font-medium">Result from {data.assignee === "claude" ? "Claude" : "the agent"}</h3>
                </header>
                <div className="max-h-[320px] overflow-y-auto px-4 py-3" data-lenis-prevent>
                  <Markdown text={data.resultMarkdown} />
                  {data.artifacts?.length ? (
                    <ul className="mt-3 flex flex-col gap-1 text-[13px]">
                      {data.artifacts.map((a, i) => (
                        <li key={i}>{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-4">{a.title}</a> : a.title}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {data.status === "needs_review" ? (
                  <div className="flex flex-col gap-2 border-t border-border p-4">
                    <Textarea value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="What should change? (visible to Claude)" className="min-h-16" aria-label="Change request" />
                    <div className="flex gap-2">
                      <Button variant="primary" size="sm" disabled={pending} onClick={() => run(() => approveTaskAction({ id: data.id }), "Approved and moved to Done")}>
                        <Check /> Approve
                      </Button>
                      <Button
                        size="sm"
                        disabled={pending || !changeNote.trim()}
                        onClick={() =>
                          run(async () => {
                            const r = await requestChangesAction({ id: data.id, comment: changeNote });
                            if (r.ok) setChangeNote("");
                            return r;
                          }, "Sent back to To do")
                        }
                      >
                        <ArrowUUpLeft /> Request changes
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section>
              <h3 className="mb-2 text-sm font-medium">Subtasks</h3>
              <ul className="flex flex-col">
                {data.subtasks.map((s) => (
                  <li key={s.id} className="flex min-h-11 items-center gap-3">
                    <Checkbox checked={s.status === "done"} onCheckedChange={(v) => run(() => toggleTaskDone({ id: s.id, done: Boolean(v) }))} aria-label={`Complete ${s.title}`} />
                    <span className={cn("text-sm", s.status === "done" && "text-muted line-through")}>{s.title}</span>
                  </li>
                ))}
              </ul>
              <form
                className="mt-1 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!subtask.trim()) return;
                  run(async () => {
                    const r = await createTaskAction({ title: subtask, parentId: data.id });
                    if (r.ok) setSubtask("");
                    return r;
                  });
                }}
              >
                <Input value={subtask} onChange={(e) => setSubtask(e.target.value)} placeholder="Add a subtask" className="h-10 text-sm" aria-label="New subtask" />
                <Button type="submit" size="icon-sm" aria-label="Add subtask">
                  <Plus />
                </Button>
              </form>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">Activity</h3>
              <ol className="flex flex-col gap-3">
                {data.comments.map((c) => (
                  <li key={c.id} className="text-[13px]">
                    <span className="font-medium">{c.author === "me" ? "You" : c.author === "claude" ? "Claude" : "Agent"}</span>
                    <span className="text-subtle"> · {c.kind === "change_request" ? "requested changes" : c.kind === "result" ? "submitted a result" : "commented"} · {timeAgo(c.createdAt)}</span>
                    {c.kind !== "result" ? <p className="mt-0.5 whitespace-pre-wrap text-muted">{c.body}</p> : null}
                  </li>
                ))}
              </ol>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!comment.trim()) return;
                  run(async () => {
                    const r = await commentTaskAction({ id: data.id, body: comment });
                    if (r.ok) setComment("");
                    return r;
                  });
                }}
              >
                <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" className="h-10 text-sm" aria-label="Comment" />
                <Button type="submit" size="sm">
                  Post
                </Button>
              </form>
            </section>

            <div className="border-t border-border pt-4">
              <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash /> Delete task
              </Button>
            </div>
          </div>
        )}
      </Sheet>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this task?"
        description="This removes the task, its subtasks link and its history. It can't be undone."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await deleteTaskAction({ id: id! });
                  if (!r.ok) return void toast.error(r.error);
                  setConfirmDelete(false);
                  onClose();
                  onChanged();
                  toast.success("Task deleted");
                })
              }
            >
              Delete
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}
