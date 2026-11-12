"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { configHistoryRead, rollbackConfig, setMaintenance, updateConfig } from "@/app/actions/admin-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConfigField } from "@/lib/config/registry";
import { timeAgo } from "@/lib/utils";
import { FieldInput, fromLocalInput, ReasonInput, runConfirmed, selectClass, showValue, toLocalInput, ValueDiff, type HistoryRow } from "./config-shared";

/** What the page sends for each key (no schemas: the server validates every save). */
export type ConfigItem = {
  key: string;
  label: string;
  description: string;
  field: ConfigField;
  value: unknown;
  defaultValue: unknown;
  isDefault: boolean;
  version: number;
  updatedAt: string | null;
  scope: "public" | "server";
  readBy: string | null;
  canEdit: boolean;
};

export function ConfigRow({ item, canRestore }: { item: ConfigItem; canRestore: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"view" | "edit" | "history">("view");
  const [draft, setDraft] = React.useState<unknown>(item.value);
  const [reason, setReason] = React.useState("");
  const [pending, start] = React.useTransition();

  const save = () =>
    start(async () => {
      const r = await updateConfig({ key: item.key, value: draft, reason });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${item.label} saved as version ${r.data.version}`);
      setMode("view");
      setReason("");
      router.refresh();
    });

  return (
    <li className="flex flex-col gap-3 px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium">{item.label}</p>
          <p className="text-[12.5px] text-muted">{item.description}</p>
          <p className="mt-1 text-[11.5px] text-subtle">
            <code>{item.key}</code>
            {" · "}
            {item.scope === "public" ? "Sent to the app and website" : "Server only"}
            {" · "}
            {item.readBy ? `Used by: ${item.readBy}` : "Nothing reads this yet"}
            {item.isDefault ? " · Default" : ` · Version ${item.version}${item.updatedAt ? `, ${timeAgo(item.updatedAt)}` : ""}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="max-w-[260px] truncate rounded-[8px] border border-border px-2 py-1 font-mono text-[12px]" title={showValue(item.value)}>
            {showValue(item.value)}
          </span>
          {item.canEdit ? (
            <Button
              size="sm"
              variant={mode === "edit" ? "secondary" : "ghost"}
              onClick={() => {
                setDraft(item.value);
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
          <FieldInput id={`f-${item.key}`} field={item.field} value={draft} onChange={setDraft} />
          <p className="text-[12px] text-muted">Default: {showValue(item.defaultValue)}</p>
          <ValueDiff before={item.value} after={draft} />
          <ReasonInput id={`r-${item.key}`} value={reason} onChange={setReason} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={pending || reason.trim().length < 3} onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(item.defaultValue)}>
              Use default
            </Button>
          </div>
        </div>
      ) : null}
      {mode === "history" ? <ConfigHistory configKey={item.key} canRestore={canRestore && item.canEdit} /> : null}
    </li>
  );
}

function ConfigHistory({ configKey, canRestore }: { configKey: string; canRestore: boolean }) {
  const router = useRouter();
  const [rows, setRows] = React.useState<HistoryRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    let live = true;
    void configHistoryRead({ key: configKey }).then((r) => {
      if (!live) return;
      if (r.ok) setRows(r.data as HistoryRow[]);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [configKey]);

  const restore = (version: number) =>
    start(async () => {
      const reason = window.prompt(`Why restore version ${version}? This goes in the audit log.`);
      if (!reason || reason.trim().length < 3) return;
      const r = await runConfirmed((token) => rollbackConfig({ key: configKey, version, reason }, token));
      if (!r) return;
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Restored as version ${r.data.version}`);
      router.refresh();
    });

  if (error) return <p className="text-[13px] text-muted">History unavailable: {error}</p>;
  if (!rows) return <p className="text-[13px] text-muted">Loading history…</p>;
  if (!rows.length) return <p className="text-[13px] text-muted">No changes yet. The default is in use.</p>;
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

export type MaintenanceState = { active: boolean; message: string | null; endsAt: string | null; pauseJobs: boolean };

/** Owner only. Every change asks for confirmation, and a fresh unlock. */
export function MaintenanceCard({ state, canEdit }: { state: MaintenanceState; canEdit: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<MaintenanceState>(state);
  const [reason, setReason] = React.useState("");
  const [pending, start] = React.useTransition();

  const save = () =>
    start(async () => {
      const r = await runConfirmed((token) => setMaintenance({ ...draft, reason }, token));
      if (!r) return;
      if (!r.ok) return void toast.error(r.error);
      toast.success(draft.active ? "Maintenance is on" : "Maintenance saved");
      setReason("");
      router.refresh();
    });

  return (
    <section className="card rounded-[14px] border border-border bg-background p-3.5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium">Maintenance</h2>
        <p className={state.active ? "text-[13px] font-medium text-danger" : "text-[13px] text-muted"}>
          {state.active ? "On: people without an admin role are blocked" : "Off"}
          {state.pauseJobs ? ". Background jobs are paused" : ""}
        </p>
      </div>
      {!canEdit ? (
        <p className="text-[13px] text-muted">Only the owner can change maintenance.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="m-active" className="text-[12.5px] text-muted">
                Maintenance mode
              </label>
              <select id="m-active" className={selectClass} value={draft.active ? "on" : "off"} onChange={(e) => setDraft({ ...draft, active: e.target.value === "on" })}>
                <option value="off">Off</option>
                <option value="on">On</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="m-jobs" className="text-[12.5px] text-muted">
                Background jobs
              </label>
              <select id="m-jobs" className={selectClass} value={draft.pauseJobs ? "paused" : "running"} onChange={(e) => setDraft({ ...draft, pauseJobs: e.target.value === "paused" })}>
                <option value="running">Running</option>
                <option value="paused">Paused</option>
              </select>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="m-msg" className="text-[12.5px] text-muted">
                Message people see
              </label>
              <Input id="m-msg" maxLength={300} className="h-10 text-[14px]" value={draft.message ?? ""} placeholder="Cowork is down for maintenance. Try again in a little while." onChange={(e) => setDraft({ ...draft, message: e.target.value || null })} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="m-end" className="text-[12.5px] text-muted">
                Expected end (optional)
              </label>
              <Input id="m-end" type="datetime-local" className="h-10 text-[14px]" value={toLocalInput(draft.endsAt)} onChange={(e) => setDraft({ ...draft, endsAt: fromLocalInput(e.target.value) })} />
            </div>
          </div>
          <ReasonInput id="m-reason" value={reason} onChange={setReason} />
          <div>
            <Button size="sm" variant={draft.active && !state.active ? "danger" : "primary"} disabled={pending || reason.trim().length < 3} onClick={save}>
              {draft.active && !state.active ? "Turn maintenance on" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
