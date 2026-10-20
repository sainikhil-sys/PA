"use client";

import { CalendarBlank, Sparkle, Trash } from "@phosphor-icons/react";
import { formatInTimeZone } from "date-fns-tz";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { deleteMeetingNotesAction, saveMeetingNotesAction, summarizeMeetingAction } from "@/app/actions/meetings";
import { approveProposalAction } from "@/app/actions/proposals";
import { ProposalCard } from "@/components/chat/proposal-card";
import { useShell } from "@/components/layout/shell-context";
import { Button } from "@/components/ui/button";
import { Dialog, Sheet } from "@/components/ui/dialog";
import { FieldHint, Label, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { fetcher } from "@/lib/fetcher";
import type { MeetingView } from "@/lib/meetings/notes";

type Ev = { id: string; title: string; start: string; end: string | null; attendees: number; meetingUrl: string | null; allDay: boolean };
type Data = { calendar: "ok" | "not_connected" | "error"; event: Ev | null; note: MeetingView | null };

const MIN_NOTES = 20;

/** Notes for one calendar event, with an AI summary whose action items wait for approval. */
export function MeetingSheet({ eventId, at, timezone, onClose }: { eventId: string | null; at: string | null; timezone: string; onClose: () => void }) {
  const key = eventId ? `/api/meetings?eventId=${encodeURIComponent(eventId)}${at ? `&at=${encodeURIComponent(at)}` : ""}` : null;
  const { data, error, mutate } = useSWR<Data>(key, fetcher, { revalidateOnFocus: false });
  const ev = data?.event ?? null;
  const range = ev ? `${formatInTimeZone(new Date(ev.start), timezone, "EEE MMM d, HH:mm")}${ev.end ? ` to ${formatInTimeZone(new Date(ev.end), timezone, "HH:mm")}` : ""}` : undefined;

  return (
    <Sheet open={eventId !== null} onOpenChange={(o) => !o && onClose()} title={ev?.title ?? "Meeting"} description={range}>
      {error && !data ? (
        <ErrorState compact />
      ) : !data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-48" />
          <Skeleton className="h-11" />
        </div>
      ) : data.calendar === "not_connected" && !data.note ? (
        <EmptyState
          icon={CalendarBlank}
          title="Connect your calendar"
          description="Meeting notes are linked to your Google Calendar events."
          action={
            <Button asChild size="sm">
              <a href="/api/integrations/google/start?returnTo=/tasks?view=schedule">Connect Google</a>
            </Button>
          }
        />
      ) : data.calendar === "error" && !data.note ? (
        <ErrorState compact message="Your calendar didn't load. Try again in a moment." />
      ) : !ev ? (
        <EmptyState icon={CalendarBlank} title="Meeting not found" description="This meeting isn't on your calendar anymore." />
      ) : ev.allDay ? (
        <EmptyState icon={CalendarBlank} title="No notes for all-day events" description="Notes work for meetings with a start time." />
      ) : (
        <MeetingBody key={ev.id} ev={ev} note={data.note} timezone={timezone} onChanged={() => void mutate()} onDeleted={onClose} />
      )}
    </Sheet>
  );
}

function MeetingBody({ ev, note, timezone, onChanged, onDeleted }: { ev: Ev; note: MeetingView | null; timezone: string; onChanged: () => void; onDeleted: () => void }) {
  const { openChat } = useShell();
  const [notes, setNotes] = React.useState(note?.notes ?? "");
  const [dirty, setDirty] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(note?.updatedAt ?? null);
  const [saving, setSaving] = React.useState(false);
  const [summarizing, setSummarizing] = React.useState(false);
  const [addingAll, setAddingAll] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [upcoming] = React.useState(() => new Date(ev.end ?? ev.start).getTime() > Date.now());

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaving(true);
    const r = await saveMeetingNotesAction({ eventId: ev.id, at: ev.start, notes });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    setDirty(false);
    setSavedAt(r.data.savedAt);
    if (!note) onChanged();
    return true;
  };

  const summarize = async () => {
    setSummarizing(true);
    try {
      if (!(await save())) return;
      const r = await summarizeMeetingAction({ eventId: ev.id });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data.items ? `${r.data.items} action ${r.data.items === 1 ? "item" : "items"} to review` : "Summary ready");
      onChanged();
    } finally {
      setSummarizing(false);
    }
  };

  const pending = (note?.items ?? []).map((i) => i.proposal).filter((p): p is NonNullable<typeof p> => p !== null && p.status === "pending");
  const addAll = async () => {
    setAddingAll(true);
    let n = 0;
    for (const p of pending) {
      const r = await approveProposalAction({ id: p.id });
      if (r.ok) n++;
      else toast.error(r.error);
    }
    setAddingAll(false);
    if (n) toast.success(`${n} ${n === 1 ? "task" : "tasks"} added`);
    onChanged();
  };

  const remove = async () => {
    setDeleting(true);
    const r = await deleteMeetingNotesAction({ eventId: ev.id });
    setDeleting(false);
    if (!r.ok) return void toast.error(r.error);
    setConfirmDelete(false);
    toast.success("Notes deleted");
    onDeleted();
  };

  const busy = saving || summarizing || addingAll || deleting;
  return (
    <>
      <div className="flex flex-col gap-6">
        {upcoming ? (
          <Button
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={() => openChat(`Prep me for my meeting "${ev.title}": attendees, recent emails with them, open tasks and talking points.`)}
          >
            Prep
          </Button>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="meeting-notes">Notes</Label>
          <Textarea
            id="meeting-notes"
            className="min-h-48"
            value={notes}
            maxLength={20_000}
            placeholder="What was discussed, decided and who does what. You can paste a transcript."
            onChange={(e) => {
              setNotes(e.target.value);
              setDirty(true);
            }}
            onBlur={() => void save()}
          />
          <FieldHint className="tabular">{saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? `Saved ${formatInTimeZone(new Date(savedAt), timezone, "MMM d, HH:mm")}` : "Notes save when you click away."}</FieldHint>
        </div>

        <Button variant="primary" className="w-fit" disabled={busy || notes.trim().length < MIN_NOTES} onClick={() => void summarize()}>
          <Sparkle /> {summarizing ? "Summarizing…" : note?.summary ? "Summarize again" : "Summarize"}
        </Button>

        {note?.summary ? (
          <>
            <section>
              <h3 className="mb-2 text-sm font-medium">Summary</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{note.summary}</p>
            </section>
            {note.decisions.length ? (
              <section>
                <h3 className="mb-2 text-sm font-medium">Decisions</h3>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
                  {note.decisions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">Action items</h3>
                {pending.length >= 2 ? (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void addAll()}>
                    {addingAll ? "Adding…" : "Add all as tasks"}
                  </Button>
                ) : null}
              </div>
              {note.items.length ? (
                <ul className="flex flex-col gap-2">
                  {note.items.map((it, i) => (
                    <li key={it.proposal?.id ?? i}>
                      {it.proposal ? (
                        <ProposalCard proposal={it.proposal} onStatus={() => onChanged()} />
                      ) : (
                        <p className="rounded-[14px] border border-border p-4 text-sm">{it.title}</p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No action items in these notes.</p>
              )}
              <FieldHint className="mt-2">Action items wait for your approval here or in Approvals. Nothing is created until you approve.</FieldHint>
            </section>
          </>
        ) : null}

        {note ? (
          <div className="border-t border-border pt-4">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash /> Delete notes
            </Button>
          </div>
        ) : null}
      </div>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete these notes?"
        description="This removes the notes and summary. Action items still waiting for approval are dismissed. Tasks you already added stay."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="primary" disabled={deleting} onClick={() => void remove()}>
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
