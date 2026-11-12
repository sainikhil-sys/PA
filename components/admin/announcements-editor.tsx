"use client";

import { useConfirm } from "./confirm";
import * as React from "react";
import { archiveAnnouncement, cancelScheduledBroadcast, createAnnouncement, updateAnnouncement } from "@/app/actions/admin-announcements";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FieldHint, Input, inputClass, Label, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/misc";
import type { FlagTargeting } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { useAdminCall } from "./users-call";

export type EditableAnnouncement = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  placement: "banner" | "home_card";
  href: string | null;
  dismissible: boolean;
  startsAt: string;
  endsAt: string | null;
  targeting: FlagTargeting;
};

const SEGMENTS = [
  { value: "admins", label: "Admins" },
  { value: "beta", label: "Beta testers" },
  { value: "new_users_30d", label: "Joined in the last 30 days" },
  { value: "signed_up_before", label: "Joined before a date" },
] as const;
type Segment = (typeof SEGMENTS)[number]["value"];

/** ISO instant to the value a datetime-local input shows (the admin's local time). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <FieldHint className="text-[12px]">{hint}</FieldHint> : null}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const id = React.useId();
  return (
    <span className="inline-flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <label htmlFor={id} className="text-[13px]">
        {label}
      </label>
    </span>
  );
}

function Form({ initial, onDone }: { initial?: EditableAnnouncement; onDone: () => void }) {
  const { pending, run } = useAdminCall();
  const id = React.useId();
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [body, setBody] = React.useState(initial?.body ?? "");
  const [severity, setSeverity] = React.useState<EditableAnnouncement["severity"]>(initial?.severity ?? "info");
  const [placement, setPlacement] = React.useState<EditableAnnouncement["placement"]>(initial?.placement ?? "banner");
  const [href, setHref] = React.useState(initial?.href ?? "");
  const [dismissible, setDismissible] = React.useState(initial?.dismissible ?? true);
  const [startsAt, setStartsAt] = React.useState(toLocalInput(initial?.startsAt));
  const [endsAt, setEndsAt] = React.useState(toLocalInput(initial?.endsAt));
  const t = initial?.targeting ?? {};
  const [platforms, setPlatforms] = React.useState<("web" | "android")[]>(t.platforms ?? []);
  const [segments, setSegments] = React.useState<Segment[]>(t.segments ?? []);
  const [before, setBefore] = React.useState(t.signedUpBefore ? t.signedUpBefore.slice(0, 10) : "");
  const [minV, setMinV] = React.useState(t.minAppVersion ?? "");
  const [maxV, setMaxV] = React.useState(t.maxAppVersion ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const flip = <T,>(list: T[], v: T, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

  const submit = () => {
    setError(null);
    const input = {
      title,
      body,
      severity,
      placement,
      href: href.trim() || null,
      dismissible,
      startsAt: fromLocalInput(startsAt),
      endsAt: fromLocalInput(endsAt),
      targeting: {
        platforms,
        segments,
        signedUpBefore: before ? new Date(`${before}T00:00:00Z`).toISOString() : null,
        minAppVersion: minV.trim(),
        maxAppVersion: maxV.trim(),
        // Kept as they were: the console doesn't edit per-person lists yet.
        allowUserIds: t.allowUserIds,
        denyUserIds: t.denyUserIds,
      },
    };
    run(() => (initial ? updateAnnouncement({ id: initial.id, ...input }) : createAnnouncement(input)), {
      done: (d) => (d.status === "live" ? "Saved. It's live now." : d.status === "scheduled" ? "Saved. It goes live at the start time." : "Saved"),
      onError: setError,
      onDone,
    });
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Title" htmlFor={`${id}-t`}>
        <Input id={`${id}-t`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className="h-10 text-[14px]" />
      </Field>
      <Field label="Message" htmlFor={`${id}-b`}>
        <Textarea id={`${id}-b`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={600} className="min-h-20 text-[14px]" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Severity" htmlFor={`${id}-s`}>
          <select id={`${id}-s`} value={severity} onChange={(e) => setSeverity(e.target.value as EditableAnnouncement["severity"])} className={cn(inputClass, "h-10 text-[14px]")}>
            <option value="info">Information</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </Field>
        <Field label="Where" htmlFor={`${id}-p`}>
          <select id={`${id}-p`} value={placement} onChange={(e) => setPlacement(e.target.value as EditableAnnouncement["placement"])} className={cn(inputClass, "h-10 text-[14px]")}>
            <option value="banner">Banner</option>
            <option value="home_card">Home card</option>
          </select>
        </Field>
        <Field label="Link (optional)" htmlFor={`${id}-h`} hint="An app page, like /settings">
          <Input id={`${id}-h`} value={href} onChange={(e) => setHref(e.target.value)} maxLength={200} placeholder="/settings" className="h-10 text-[14px]" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts" htmlFor={`${id}-a`} hint="Empty means now">
          <Input id={`${id}-a`} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="h-10 text-[14px]" />
        </Field>
        <Field label="Ends (optional)" htmlFor={`${id}-z`} hint="Empty means until you archive it">
          <Input id={`${id}-z`} type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="h-10 text-[14px]" />
        </Field>
      </div>
      <Toggle checked={dismissible} onChange={setDismissible} label="People can dismiss it" />

      <fieldset className="flex flex-col gap-2 rounded-[12px] border border-border p-3">
        <legend className="px-1 text-[13px] font-medium">Who sees it</legend>
        <p className="text-[12px] text-muted">Nothing selected means everyone. With several groups, being in any one of them is enough.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Toggle checked={platforms.includes("web")} onChange={(v) => setPlatforms(flip(platforms, "web", v))} label="Website" />
          <Toggle checked={platforms.includes("android")} onChange={(v) => setPlatforms(flip(platforms, "android", v))} label="Android app" />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {SEGMENTS.map((s) => (
            <Toggle key={s.value} checked={segments.includes(s.value)} onChange={(v) => setSegments(flip(segments, s.value, v))} label={s.label} />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {segments.includes("signed_up_before") ? (
            <Field label="Joined before" htmlFor={`${id}-j`}>
              <Input id={`${id}-j`} type="date" value={before} onChange={(e) => setBefore(e.target.value)} className="h-10 text-[14px]" />
            </Field>
          ) : null}
          <Field label="App version from" htmlFor={`${id}-min`} hint="App only">
            <Input id={`${id}-min`} value={minV} onChange={(e) => setMinV(e.target.value)} maxLength={40} placeholder="1.0.0" className="h-10 text-[14px]" />
          </Field>
          <Field label="App version up to" htmlFor={`${id}-max`} hint="App only">
            <Input id={`${id}-max`} value={maxV} onChange={(e) => setMaxV(e.target.value)} maxLength={40} placeholder="1.9.9" className="h-10 text-[14px]" />
          </Field>
        </div>
      </fieldset>

      <FieldError>{error}</FieldError>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending || title.trim().length < 3 || body.trim().length < 3}>
          {pending ? "Saving" : initial ? "Save changes" : "Create announcement"}
        </Button>
      </div>
    </form>
  );
}

export function NewAnnouncement() {
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState(0);
  if (!open)
    return (
      <div>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          New announcement
        </Button>
      </div>
    );
  return (
    <div className="card rounded-[14px] border border-border bg-background p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[15px] font-medium">New announcement</h2>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <Form
        key={key}
        onDone={() => {
          setKey((k) => k + 1);
          setOpen(false);
        }}
      />
    </div>
  );
}

export function AnnouncementActions({ announcement, archived }: { announcement: EditableAnnouncement; archived: boolean }) {
  const { pending, run } = useAdminCall();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState(false);
  if (archived) return null;
  return (
    <div className="flex justify-end gap-1.5">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={async () => {
          if (!(await confirm({ title: "Archive this announcement?", message: "It disappears for everyone right away.", confirmLabel: "Archive" }))) return;
          run(() => archiveAnnouncement({ id: announcement.id }), { done: "Archived" });
        }}
      >
        Archive
      </Button>
      <Dialog open={editing} onOpenChange={setEditing} title="Edit announcement" className="max-w-2xl">
        <Form initial={announcement} onDone={() => setEditing(false)} />
      </Dialog>
    </div>
  );
}

export function CancelScheduledBroadcast({ id }: { id: string }) {
  const { pending, run } = useAdminCall();
  const confirm = useConfirm();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm({ title: "Cancel this scheduled broadcast?", message: "Nobody receives it.", confirmLabel: "Cancel broadcast", danger: true }))) return;
        run(() => cancelScheduledBroadcast({ id }), { done: "Scheduled broadcast cancelled" });
      }}
    >
      Cancel
    </Button>
  );
}
