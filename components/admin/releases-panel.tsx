"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { createRelease, setReleaseStatus, updatePolicy } from "@/app/actions/admin-releases";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import type { UpdatePolicy } from "@/lib/config/registry";
import { ReasonInput, runConfirmed, selectClass, ValueDiff } from "./config-shared";
import { useConfirm } from "./confirm";

function Field({ label, id, children, hint }: { label: string; id: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12.5px] text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11.5px] text-subtle">{hint}</p> : null}
    </div>
  );
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v) || 0)));

/** The Android update policy. Raising the required build asks the owner to confirm. */
export function PolicyForm({ policy, canEdit, canMandate, blockedReason }: { policy: UpdatePolicy; canEdit: boolean; canMandate: boolean; blockedReason: string | null }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [draft, setDraft] = React.useState<UpdatePolicy>(policy);
  const [reason, setReason] = React.useState("");
  const [pending, start] = React.useTransition();
  if (!canEdit) return null;

  const save = () =>
    start(async () => {
      const r = await runConfirmed((token) => updatePolicy({ policy: draft, reason }, token), confirm);
      if (!r) return;
      if (!r.ok) return void toast.error(r.error);
      toast.success("Update policy saved");
      setReason("");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Minimum build" id="p-min" hint="0 means no minimum. Older builds get an update screen.">
          <Input id="p-min" type="number" min={0} className="h-10 text-[14px]" value={draft.minBuild} onChange={(e) => setDraft({ ...draft, minBuild: numOrNull(e.target.value) ?? 0 })} />
        </Field>
        <Field label="Latest version" id="p-lv">
          <Input id="p-lv" placeholder="1.2.0" className="h-10 text-[14px]" value={draft.latestVersion ?? ""} onChange={(e) => setDraft({ ...draft, latestVersion: e.target.value.trim() || null })} />
        </Field>
        <Field label="Latest build" id="p-lb">
          <Input id="p-lb" type="number" min={1} className="h-10 text-[14px]" value={draft.latestBuild ?? ""} onChange={(e) => setDraft({ ...draft, latestBuild: numOrNull(e.target.value) || null })} />
        </Field>
        <Field label="Latest update is" id="p-mode">
          <select id="p-mode" className={selectClass} value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value === "required" ? "required" : "optional" })}>
            <option value="optional">Optional</option>
            <option value="required">Required</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Store link" id="p-url">
            <Input id="p-url" placeholder="https://play.google.com/store/apps/details?id=..." className="h-10 text-[14px]" value={draft.storeUrl ?? ""} onChange={(e) => setDraft({ ...draft, storeUrl: e.target.value.trim() || null })} />
          </Field>
        </div>
      </div>
      <Field label="Message on the update screen" id="p-msg">
        <Textarea id="p-msg" rows={2} maxLength={300} className="min-h-16 text-[14px]" value={draft.message ?? ""} onChange={(e) => setDraft({ ...draft, message: e.target.value || null })} />
      </Field>
      <ValueDiff before={policy} after={draft} />
      {blockedReason ? <p className="text-[12.5px] text-muted">A minimum can&apos;t be set yet. {blockedReason}</p> : null}
      {!canMandate ? <p className="text-[12.5px] text-muted">Only the owner can raise the minimum or make an update required.</p> : null}
      <ReasonInput id="p-reason" value={reason} onChange={setReason} />
      <div>
        <Button size="sm" variant="primary" disabled={pending || reason.trim().length < 3} onClick={save}>
          Save policy
        </Button>
      </div>
    </div>
  );
}

const STATUS_LABEL = { draft: "Draft", testing: "Testing", live: "Live", halted: "Halted", retired: "Retired" } as const;
type Status = keyof typeof STATUS_LABEL;

export function ReleaseStatus({ id, status, canEdit }: { id: string; status: Status; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  if (!canEdit) return <span>{STATUS_LABEL[status]}</span>;
  return (
    <select
      aria-label="Release status"
      className={selectClass}
      disabled={pending}
      value={status}
      onChange={(e) => {
        const next = e.target.value as Status;
        start(async () => {
          const r = await setReleaseStatus({ id, status: next });
          if (!r.ok) return void toast.error(r.error);
          toast.success(`Marked ${STATUS_LABEL[next].toLowerCase()}`);
          router.refresh();
        });
      }}
    >
      {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

/** Records a store build or an OTA update. Publishing itself happens outside the console. */
export function NewRelease() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<"store" | "ota">("store");
  const [f, setF] = React.useState({ version: "", buildNumber: "", runtimeVersion: "", channel: "production" as "production" | "preview", updateGroupId: "", notes: "", storeUrl: "" });
  const [pending, start] = React.useTransition();
  if (!open)
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Record a release
      </Button>
    );

  const save = () =>
    start(async () => {
      const r = await createRelease({
        platform: "android",
        kind,
        version: f.version.trim(),
        buildNumber: kind === "store" ? numOrNull(f.buildNumber) : null,
        runtimeVersion: f.runtimeVersion.trim() || null,
        channel: f.channel,
        updateGroupId: kind === "ota" ? f.updateGroupId.trim() || null : null,
        notes: f.notes,
        storeUrl: kind === "store" ? f.storeUrl.trim() || null : null,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Release recorded as a draft");
      setOpen(false);
      router.refresh();
    });

  return (
    <div className="card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-3.5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Type" id="n-kind">
          <select id="n-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value === "ota" ? "ota" : "store")}>
            <option value="store">Store build</option>
            <option value="ota">OTA update</option>
          </select>
        </Field>
        <Field label="Version" id="n-v">
          <Input id="n-v" placeholder="1.2.0" className="h-10 text-[14px]" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} />
        </Field>
        <Field label="Channel" id="n-ch">
          <select id="n-ch" className={selectClass} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value === "preview" ? "preview" : "production" })}>
            <option value="production">Production</option>
            <option value="preview">Preview</option>
          </select>
        </Field>
        {kind === "store" ? (
          <Field label="Build number (versionCode)" id="n-b">
            <Input id="n-b" type="number" min={1} className="h-10 text-[14px]" value={f.buildNumber} onChange={(e) => setF({ ...f, buildNumber: e.target.value })} />
          </Field>
        ) : (
          <Field label="Update group id" id="n-g">
            <Input id="n-g" className="h-10 font-mono text-[13px]" value={f.updateGroupId} onChange={(e) => setF({ ...f, updateGroupId: e.target.value })} />
          </Field>
        )}
        <Field label={kind === "store" ? "Runtime version (optional)" : "Runtime version"} id="n-rt">
          <Input id="n-rt" className="h-10 font-mono text-[13px]" value={f.runtimeVersion} onChange={(e) => setF({ ...f, runtimeVersion: e.target.value })} />
        </Field>
        {kind === "store" ? (
          <Field label="Store link (optional)" id="n-url">
            <Input id="n-url" className="h-10 text-[14px]" value={f.storeUrl} onChange={(e) => setF({ ...f, storeUrl: e.target.value })} />
          </Field>
        ) : null}
      </div>
      <Field label="Release notes" id="n-notes">
        <Textarea id="n-notes" rows={3} maxLength={2000} className="min-h-20 text-[14px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={pending || !f.version.trim()} onClick={save}>
          Save as draft
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
