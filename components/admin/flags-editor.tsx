"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { flagHistoryRead, restoreFlag, updateFlag } from "@/app/actions/admin-flags";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import type { FlagTargeting } from "@/lib/db/schema";
import { timeAgo } from "@/lib/utils";
import { fromLocalInput, ReasonInput, selectClass, toLocalInput, ValueDiff, type HistoryRow } from "./config-shared";

export type FlagStateView = { enabled: boolean; rolloutPercent: number; targeting: FlagTargeting; startsAt: string | null; endsAt: string | null; description: string };

export type FlagItem = {
  key: string;
  label: string;
  description: string;
  default: boolean;
  enforcedIn: string | null;
  state: FlagStateView | null;
  version: number;
  updatedAt: string | null;
};

const SEGMENTS = [
  { value: "admins", label: "Admins" },
  { value: "beta", label: "Beta testers (none yet)" },
  { value: "new_users_30d", label: "Joined in the last 30 days" },
  { value: "signed_up_before", label: "Joined before a date" },
] as const;

function summary(item: FlagItem): string {
  const s = item.state;
  if (!s) return `Default: ${item.default ? "on for everyone" : "off"}`;
  if (!s.enabled) return "Off for everyone";
  const parts = [`On for ${s.rolloutPercent}%`];
  if (s.targeting.platforms?.length) parts.push(s.targeting.platforms.join(" and "));
  if (s.targeting.segments?.length) parts.push(`segments: ${s.targeting.segments.join(", ")}`);
  if (s.targeting.allowUserIds?.length) parts.push(`${s.targeting.allowUserIds.length} always on`);
  if (s.targeting.denyUserIds?.length) parts.push(`${s.targeting.denyUserIds.length} always off`);
  if (s.startsAt || s.endsAt) parts.push("time window");
  return parts.join(", ");
}

const ids = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Drops empty targeting fields so the stored value stays small and the diff readable. */
function cleanTargeting(t: FlagTargeting): FlagTargeting {
  const out: FlagTargeting = {};
  if (t.platforms?.length) out.platforms = t.platforms;
  if (t.minAppVersion) out.minAppVersion = t.minAppVersion;
  if (t.maxAppVersion) out.maxAppVersion = t.maxAppVersion;
  if (t.segments?.length) out.segments = t.segments;
  if (t.signedUpBefore && t.segments?.includes("signed_up_before")) out.signedUpBefore = t.signedUpBefore;
  if (t.allowUserIds?.length) out.allowUserIds = t.allowUserIds;
  if (t.denyUserIds?.length) out.denyUserIds = t.denyUserIds;
  return out;
}

export function FlagRow({ item, canEdit }: { item: FlagItem; canEdit: boolean }) {
  const router = useRouter();
  const initial: FlagStateView = item.state ?? { enabled: item.default, rolloutPercent: item.default ? 100 : 0, targeting: {}, startsAt: null, endsAt: null, description: "" };
  const [mode, setMode] = React.useState<"view" | "edit" | "history">("view");
  const [draft, setDraft] = React.useState<FlagStateView>(initial);
  const [allow, setAllow] = React.useState((initial.targeting.allowUserIds ?? []).join("\n"));
  const [deny, setDeny] = React.useState((initial.targeting.denyUserIds ?? []).join("\n"));
  const [reason, setReason] = React.useState("");
  const [pending, start] = React.useTransition();

  const t = draft.targeting;
  const setT = (patch: Partial<FlagTargeting>) => setDraft({ ...draft, targeting: { ...t, ...patch } });
  const next: FlagStateView = { ...draft, targeting: cleanTargeting({ ...t, allowUserIds: ids(allow), denyUserIds: ids(deny) }) };

  const save = () =>
    start(async () => {
      const r = await updateFlag({ key: item.key, state: next, reason });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${item.label} saved as version ${r.data.version}`);
      setMode("view");
      setReason("");
      router.refresh();
    });

  const toggle = (list: string[] | undefined, value: string, on: boolean) => (on ? [...new Set([...(list ?? []), value])] : (list ?? []).filter((v) => v !== value));

  return (
    <li className="flex flex-col gap-3 px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium">{item.label}</p>
          <p className="text-[12.5px] text-muted">{item.description}</p>
          <p className="mt-1 text-[11.5px] text-subtle">
            <code>{item.key}</code>
            {" · "}
            {item.enforcedIn ? `Refused by the server in ${item.enforcedIn}` : "No server route checks this flag yet; only clients that read it change"}
            {item.version ? ` · Version ${item.version}${item.updatedAt ? `, ${timeAgo(item.updatedAt)}` : ""}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-[8px] border border-border px-2 py-1 text-[12px]">{summary(item)}</span>
          {canEdit ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(initial);
                setAllow((initial.targeting.allowUserIds ?? []).join("\n"));
                setDeny((initial.targeting.denyUserIds ?? []).join("\n"));
                setMode(mode === "edit" ? "view" : "edit");
              }}
            >
              {mode === "edit" ? "Close" : "Edit"}
            </Button>
          ) : null}
          <Button size="sm" variant="quiet" onClick={() => setMode(mode === "history" ? "view" : "history")}>
            History
          </Button>
        </div>
      </div>

      {mode === "edit" ? (
        <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-surface/50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Flag" id={`${item.key}-en`}>
              <select id={`${item.key}-en`} className={selectClass} value={draft.enabled ? "on" : "off"} onChange={(e) => setDraft({ ...draft, enabled: e.target.value === "on" })}>
                <option value="on">On</option>
                <option value="off">Off for everyone</option>
              </select>
            </Field>
            <Field label="Share of people (percent)" id={`${item.key}-pct`}>
              <Input
                id={`${item.key}-pct`}
                type="number"
                min={0}
                max={100}
                className="h-10 max-w-[140px] text-[14px]"
                value={draft.rolloutPercent}
                onChange={(e) => setDraft({ ...draft, rolloutPercent: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
              />
            </Field>
            <Field label="Starts (optional)" id={`${item.key}-start`}>
              <Input id={`${item.key}-start`} type="datetime-local" className="h-10 text-[14px]" value={toLocalInput(draft.startsAt)} onChange={(e) => setDraft({ ...draft, startsAt: fromLocalInput(e.target.value) })} />
            </Field>
            <Field label="Ends (optional)" id={`${item.key}-end`}>
              <Input id={`${item.key}-end`} type="datetime-local" className="h-10 text-[14px]" value={toLocalInput(draft.endsAt)} onChange={(e) => setDraft({ ...draft, endsAt: fromLocalInput(e.target.value) })} />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[12.5px] text-muted">Only these platforms (none ticked means all)</legend>
            <div className="flex gap-4 text-[13.5px]">
              {(["web", "android"] as const).map((p) => (
                <label key={p} className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(t.platforms?.includes(p))} onChange={(e) => setT({ platforms: toggle(t.platforms, p, e.target.checked) as FlagTargeting["platforms"] })} />
                  {p === "web" ? "Website" : "Android app"}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lowest app version (optional)" id={`${item.key}-minv`}>
              <Input id={`${item.key}-minv`} placeholder="1.2.0" className="h-10 text-[14px]" value={t.minAppVersion ?? ""} onChange={(e) => setT({ minAppVersion: e.target.value.trim() || undefined })} />
            </Field>
            <Field label="Highest app version (optional)" id={`${item.key}-maxv`}>
              <Input id={`${item.key}-maxv`} placeholder="1.9.0" className="h-10 text-[14px]" value={t.maxAppVersion ?? ""} onChange={(e) => setT({ maxAppVersion: e.target.value.trim() || undefined })} />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[12.5px] text-muted">Only these groups (none ticked means everyone)</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13.5px]">
              {SEGMENTS.map((s) => (
                <label key={s.value} className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(t.segments?.includes(s.value))} onChange={(e) => setT({ segments: toggle(t.segments, s.value, e.target.checked) as FlagTargeting["segments"] })} />
                  {s.label}
                </label>
              ))}
            </div>
            {t.segments?.includes("signed_up_before") ? (
              <Input type="date" aria-label="Joined before" className="h-10 max-w-[200px] text-[14px]" value={t.signedUpBefore?.slice(0, 10) ?? ""} onChange={(e) => setT({ signedUpBefore: e.target.value ? new Date(`${e.target.value}T00:00:00Z`).toISOString() : undefined })} />
            ) : null}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Always on for these account ids" id={`${item.key}-allow`}>
              <Textarea id={`${item.key}-allow`} rows={2} className="min-h-16 font-mono text-[12px]" value={allow} onChange={(e) => setAllow(e.target.value)} />
            </Field>
            <Field label="Always off for these account ids" id={`${item.key}-deny`}>
              <Textarea id={`${item.key}-deny`} rows={2} className="min-h-16 font-mono text-[12px]" value={deny} onChange={(e) => setDeny(e.target.value)} />
            </Field>
          </div>

          <ValueDiff before={item.state} after={next} />
          <ReasonInput id={`${item.key}-reason`} value={reason} onChange={setReason} />
          <div>
            <Button size="sm" variant="primary" disabled={pending || reason.trim().length < 3} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "history" ? <FlagHistory flagKey={item.key} canRestore={canEdit} /> : null}
    </li>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12.5px] text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function FlagHistory({ flagKey, canRestore }: { flagKey: string; canRestore: boolean }) {
  const router = useRouter();
  const [rows, setRows] = React.useState<HistoryRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    let live = true;
    void flagHistoryRead({ key: flagKey }).then((r) => {
      if (!live) return;
      if (r.ok) setRows(r.data as HistoryRow[]);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [flagKey]);

  const restore = (version: number) =>
    start(async () => {
      const reason = window.prompt(`Why restore version ${version}? This goes in the audit log.`);
      if (!reason || reason.trim().length < 3) return;
      const r = await restoreFlag({ key: flagKey, version, reason });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Restored as version ${r.data.version}`);
      router.refresh();
    });

  if (error) return <p className="text-[13px] text-muted">History unavailable: {error}</p>;
  if (!rows) return <p className="text-[13px] text-muted">Loading history…</p>;
  if (!rows.length) return <p className="text-[13px] text-muted">No changes yet. The code default is in use.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {rows.map((h, i) => (
        <li key={h.version} className="rounded-[12px] border border-border p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <span>
              <span className="font-medium">Version {h.version}</span>
              <span className="text-muted">
                {" · "}
                {timeAgo(h.createdAt)}
                {h.actorEmail ? ` · ${h.actorEmail}` : ""}
                {h.restoredFromVersion ? ` · restored from version ${h.restoredFromVersion}` : ""}
              </span>
            </span>
            {canRestore && i > 0 ? (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => restore(h.version)}>
                Restore this version
              </Button>
            ) : null}
          </div>
          {h.reason ? <p className="mb-2 text-[12.5px] text-muted">{h.reason}</p> : null}
          <ValueDiff before={h.previousValue} after={h.value} />
        </li>
      ))}
    </ol>
  );
}
