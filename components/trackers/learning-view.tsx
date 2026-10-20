"use client";

import { ArrowSquareOut, BookOpen, Clock, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { createLearningItemAction, deleteLearningItemAction, logLearningTimeAction, updateLearningItemAction } from "@/app/actions/trackers";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/states";
import { formatMinutes, shortDate } from "@/lib/trackers/dates";
import { Field, Select, useShowAll } from "./fields";

export type LearningItem = {
  id: string;
  title: string;
  kind: string;
  status: string;
  progress: number;
  url: string | null;
  notes: string;
  targetDate: string | null;
  /** Local date it was marked done, in the user's timezone. */
  completedOn: string | null;
  updatedAt: string;
  minutes: number;
};

type Kind = "course" | "book" | "skill" | "video" | "other";
type Status = "planned" | "active" | "paused" | "done";

const KINDS: { value: Kind; label: string }[] = [
  { value: "course", label: "Course" },
  { value: "book", label: "Book" },
  { value: "skill", label: "Skill" },
  { value: "video", label: "Video" },
  { value: "other", label: "Other" },
];
const STATUSES: { value: Status; label: string }[] = [
  { value: "active", label: "Learning" },
  { value: "planned", label: "Planned" },
  { value: "paused", label: "Paused" },
  { value: "done", label: "Done" },
];
const ORDER: Record<string, number> = { active: 0, planned: 1, paused: 2, done: 3 };

export function LearningView({ items, today, weekMinutes, streak, streakCapped }: { items: LearningItem[]; today: string; weekMinutes: number; streak: number; streakCapped: boolean }) {
  const [editing, setEditing] = React.useState<LearningItem | "new" | null>(null);
  const [logging, setLogging] = React.useState<LearningItem | null>(null);
  const sorted = React.useMemo(() => [...items].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9)), [items]);
  const { visible, hidden, showAll } = useShowAll(sorted);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus /> Add item
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="This week" description="Since Monday" />
          <CardBody>
            <p className="tabular font-serif text-[28px] leading-tight">{formatMinutes(weekMinutes)}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Streak" description="Days in a row" />
          <CardBody>
            <p className="tabular font-serif text-[28px] leading-tight">
              {streak}
              {streakCapped ? "+" : ""} {streak === 1 ? "day" : "days"}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        {items.length ? (
          <ul className="divide-y divide-border">
            {visible.map((it) => (
              <ItemRow key={it.id} item={it} today={today} onEdit={() => setEditing(it)} onLog={() => setLogging(it)} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={BookOpen}
            title="Nothing on your list yet."
            description="Add a course, book or skill to track progress and time."
            action={
              <Button size="sm" onClick={() => setEditing("new")}>
                Add your first item
              </Button>
            }
          />
        )}
        {hidden ? (
          <div className="border-t border-border px-4 py-2 sm:px-5">
            <Button variant="quiet" onClick={showAll}>
              Show all {items.length}
            </Button>
          </div>
        ) : null}
      </Card>

      <ItemDialog item={editing === "new" ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
      <LogTimeDialog item={logging} today={today} onOpenChange={(o) => !o && setLogging(null)} />
    </div>
  );
}

function ItemRow({ item, today, onEdit, onLog }: { item: LearningItem; today: string; onEdit: () => void; onLog: () => void }) {
  const [progress, setProgress] = React.useState(item.progress);
  const [status, setStatus] = React.useState(item.status);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => setProgress(item.progress), [item.progress]);
  React.useEffect(() => setStatus(item.status), [item.status]);
  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const save = async (patch: { status?: Status; progress?: number }) => {
    const res = await updateLearningItemAction({ id: item.id, ...patch });
    if (!res.ok) {
      toast.error(res.error);
      setProgress(item.progress);
      setStatus(item.status);
    }
  };
  // Save once the slider settles instead of on every step.
  const onSlide = (v: number) => {
    setProgress(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save({ progress: v }), 500);
  };

  const overdue = item.targetDate && item.status !== "done" && item.targetDate < today;
  const kind = KINDS.find((k) => k.value === item.kind)?.label ?? item.kind;

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-[15px] font-medium hover:underline">
              <span className={item.status === "done" ? "truncate text-muted line-through" : "truncate"}>{item.title}</span>
              <ArrowSquareOut size={14} className="shrink-0 text-subtle" aria-label="Opens in a new tab" />
            </a>
          ) : (
            <p className={item.status === "done" ? "truncate text-[15px] font-medium text-muted line-through" : "truncate text-[15px] font-medium"}>{item.title}</p>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            <span>{kind}</span>
            <span aria-hidden>·</span>
            <span className="tabular">{item.minutes ? `${formatMinutes(item.minutes)} logged` : "No time logged"}</span>
            {item.status === "done" && item.completedOn ? (
              <>
                <span aria-hidden>·</span>
                <span>Finished {shortDate(item.completedOn)}</span>
              </>
            ) : item.targetDate ? (
              <>
                <span aria-hidden>·</span>
                {overdue ? (
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <StatusDot state="error" />
                    Overdue, target was {shortDate(item.targetDate)}
                  </span>
                ) : (
                  <span>Target {shortDate(item.targetDate)}</span>
                )}
              </>
            ) : null}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${item.title}`}>
          <PencilSimple />
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex h-11 flex-1 items-center gap-3">
          <span className="sr-only">Progress</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => onSlide(Number(e.target.value))}
            className="h-11 w-full cursor-pointer accent-foreground"
            aria-valuetext={`${progress}%`}
          />
          <span className="tabular w-10 shrink-0 text-right text-[13px] text-muted">{progress}%</span>
        </label>
        <div className="flex gap-2">
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              const next = e.target.value as Status;
              setStatus(next);
              if (next === "done") setProgress(100);
              void save({ status: next });
            }}
            className="w-auto flex-1 text-[14px] sm:flex-none"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Button onClick={onLog}>
            <Clock /> Log time
          </Button>
        </div>
      </div>
    </li>
  );
}

function ItemDialog({ item, open, onOpenChange }: { item: LearningItem | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = React.useState("");
  const [kind, setKind] = React.useState<Kind>("course");
  const [url, setUrl] = React.useState("");
  const [targetDate, setTargetDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    if (!open) return;
    setTitle(item?.title ?? "");
    setKind((item?.kind as Kind) ?? "course");
    setUrl(item?.url ?? "");
    setTargetDate(item?.targetDate ?? "");
    setNotes(item?.notes ?? "");
    setError(null);
  }, [open, item]);

  const save = () =>
    start(async () => {
      const input = { title, kind, url, notes, targetDate: targetDate || null };
      const res = item ? await updateLearningItemAction({ id: item.id, ...input }) : await createLearningItemAction(input);
      if (!res.ok) return void setError(res.error);
      toast.success(item ? "Saved" : "Added");
      onOpenChange(false);
    });

  const remove = () =>
    start(async () => {
      if (!item) return;
      const res = await deleteLearningItemAction({ id: item.id });
      if (!res.ok) return void toast.error(res.error);
      setConfirmDelete(false);
      onOpenChange(false);
      toast.success("Deleted");
    });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={item ? "Edit item" : "Add something to learn"}
        footer={
          <>
            {item ? (
              <Button variant="danger" className="sm:mr-auto" disabled={pending} onClick={() => setConfirmDelete(true)}>
                <Trash /> Delete
              </Button>
            ) : null}
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form="learning-form" disabled={pending}>
              {item ? "Save" : "Add"}
            </Button>
          </>
        }
      >
        <form
          id="learning-form"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="Title" htmlFor="li-title" className="sm:col-span-2">
            <Input id="li-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Rust in Action" required />
          </Field>
          <Field label="Kind" htmlFor="li-kind">
            <Select id="li-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target date" htmlFor="li-target">
            <Input id="li-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
          <Field label="Link" htmlFor="li-url" className="sm:col-span-2">
            <Input id="li-url" type="url" inputMode="url" value={url} maxLength={2000} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </Field>
          <Field label="Notes" htmlFor="li-notes" className="sm:col-span-2">
            <Textarea id="li-notes" value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="min-h-20" />
          </Field>
          <div className="sm:col-span-2">
            <FieldError>{error}</FieldError>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this item?"
        description="Its logged time goes with it, so your weekly minutes and streak may drop. This can't be undone."
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
    </>
  );
}

function LogTimeDialog({ item, today, onOpenChange }: { item: LearningItem | null; today: string; onOpenChange: (o: boolean) => void }) {
  const [minutes, setMinutes] = React.useState("30");
  const [date, setDate] = React.useState(today);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    if (!item) return;
    setMinutes("30");
    setDate(today);
    setNote("");
    setError(null);
  }, [item, today]);

  return (
    <Dialog
      open={item !== null}
      onOpenChange={onOpenChange}
      title="Log time"
      description={item?.title}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="log-form" disabled={pending}>
            Log
          </Button>
        </>
      }
    >
      <form
        id="log-form"
        className="grid grid-cols-2 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!item) return;
          const n = Number(minutes);
          if (!Number.isInteger(n) || n < 1 || n > 1440) return setError("Enter whole minutes between 1 and 1440.");
          start(async () => {
            const res = await logLearningTimeAction({ itemId: item.id, minutes: n, loggedOn: date, note });
            if (!res.ok) return void setError(res.error);
            toast.success(`Logged ${formatMinutes(n)}`);
            onOpenChange(false);
          });
        }}
      >
        <Field label="Minutes" htmlFor="log-minutes">
          <Input id="log-minutes" type="number" inputMode="numeric" min={1} max={1440} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="tabular" required />
        </Field>
        <Field label="Date" htmlFor="log-date">
          <Input id="log-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Note" htmlFor="log-note" className="col-span-2">
          <Input id="log-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Optional, like chapter 4" />
        </Field>
        <div className="col-span-2">
          <FieldError>{error}</FieldError>
        </div>
      </form>
    </Dialog>
  );
}
