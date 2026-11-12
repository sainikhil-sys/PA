"use client";

import * as React from "react";
import type { AdminActionResult } from "@/lib/admin/adapters";
import type { ConfirmOptions } from "./confirm";
import type { ConfigField } from "@/lib/config/registry";
import { Input, inputClass, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Runs a console action. A destructive one answers "confirm_required" with a plain summary: the person
 * confirms it and the action runs again with the one-time token.
 */
export async function runConfirmed<R>(call: (token?: string) => Promise<AdminActionResult<R>>, confirm: (o: ConfirmOptions) => Promise<boolean>): Promise<AdminActionResult<R> | null> {
  const first = await call();
  if (first.ok || first.code !== "confirm_required" || !first.confirm) return first;
  if (!(await confirm({ title: "Confirm this change", message: first.confirm.summary, confirmLabel: "Confirm", danger: true }))) return null;
  return call(first.confirm.token);
}

/** A value as short readable text. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined) return "Not set";
  if (v === true) return "On";
  if (v === false) return "Off";
  if (typeof v === "string") return v === "" ? "Empty" : v;
  if (typeof v === "number") return v.toLocaleString();
  return JSON.stringify(v, null, 2);
}

export function ValueDiff({ before, after }: { before: unknown; after: unknown }) {
  const same = JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
  return (
    <div className="grid gap-2 text-[12.5px] sm:grid-cols-2">
      <div className="rounded-[10px] border border-border bg-surface p-2.5">
        <p className="mb-1 text-[11.5px] text-muted">Now</p>
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px]">{showValue(before)}</pre>
      </div>
      <div className={cn("rounded-[10px] border p-2.5", same ? "border-border" : "border-foreground/40")}>
        <p className="mb-1 text-[11.5px] text-muted">{same ? "No change" : "After saving"}</p>
        <pre className="whitespace-pre-wrap break-words font-mono text-[12px]">{showValue(after)}</pre>
      </div>
    </div>
  );
}

/** ISO string to the value of a datetime-local input (local time). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const selectClass = cn(inputClass, "h-10 text-[14px]");

/** One input for a registry field. JSON fields keep their text until it parses. */
export function FieldInput({ field, value, onChange, id }: { field: ConfigField; value: unknown; onChange: (v: unknown) => void; id: string }) {
  const [jsonText, setJsonText] = React.useState(() => (field.kind === "json" ? JSON.stringify(value ?? {}, null, 2) : ""));
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  switch (field.kind) {
    case "boolean":
      return (
        <select id={id} className={selectClass} value={value ? "on" : "off"} onChange={(e) => onChange(e.target.value === "on")}>
          <option value="on">{field.on ?? "On"}</option>
          <option value="off">{field.off ?? "Off"}</option>
        </select>
      );
    case "tristate":
      return (
        <select id={id} className={selectClass} value={value === null || value === undefined ? "null" : value ? "on" : "off"} onChange={(e) => onChange(e.target.value === "null" ? null : e.target.value === "on")}>
          <option value="null">{field.nullLabel}</option>
          <option value="on">{field.on}</option>
          <option value="off">{field.off}</option>
        </select>
      );
    case "integer":
      return (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={field.min}
            max={field.max}
            step={1}
            className="h-10 max-w-[220px] text-[14px]"
            value={value === null || value === undefined ? "" : String(value)}
            placeholder={field.nullable ? (field.nullLabel ?? "Not set") : undefined}
            onChange={(e) => onChange(e.target.value === "" ? (field.nullable ? null : field.min) : Number(e.target.value))}
          />
          {field.unit ? <span className="text-[13px] text-muted">{field.unit}</span> : null}
        </div>
      );
    case "text":
      return field.multiline ? (
        <Textarea id={id} rows={3} maxLength={field.max} className="min-h-20 text-[14px]" value={(value as string | null) ?? ""} onChange={(e) => onChange(e.target.value === "" && field.nullable ? null : e.target.value)} />
      ) : (
        <Input id={id} maxLength={field.max} className="h-10 text-[14px]" value={(value as string | null) ?? ""} onChange={(e) => onChange(e.target.value === "" && field.nullable ? null : e.target.value)} />
      );
    case "choice":
      return (
        <select id={id} className={selectClass} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "datetime":
      return <Input id={id} type="datetime-local" className="h-10 max-w-[260px] text-[14px]" value={toLocalInput(value as string | null)} onChange={(e) => onChange(fromLocalInput(e.target.value))} />;
    case "object": {
      const obj = (value ?? {}) as Record<string, unknown>;
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {field.fields.map((f) => (
            <div key={f.name} className="flex flex-col gap-1">
              <label htmlFor={`${id}-${f.name}`} className="text-[12.5px] text-muted">
                {f.label}
              </label>
              <FieldInput id={`${id}-${f.name}`} field={f.field} value={obj[f.name]} onChange={(v) => onChange({ ...obj, [f.name]: v })} />
            </div>
          ))}
        </div>
      );
    }
    case "json":
      return (
        <div className="flex flex-col gap-1">
          <Textarea
            id={id}
            rows={6}
            spellCheck={false}
            className="font-mono text-[12.5px]"
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              try {
                onChange(JSON.parse(e.target.value));
                setJsonError(null);
              } catch {
                setJsonError("This isn't valid JSON yet.");
              }
            }}
          />
          <p className="text-[12px] text-muted">{jsonError ?? `Example: ${field.hint}`}</p>
        </div>
      );
  }
}

export function ReasonInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12.5px] text-muted">
        Reason (kept in the audit log)
      </label>
      <Input id={id} maxLength={500} className="h-10 text-[14px]" value={value} onChange={(e) => onChange(e.target.value)} placeholder="What this change is for" />
    </div>
  );
}

export type HistoryRow = { version: number; value: unknown; previousValue: unknown; restoredFromVersion: number | null; reason: string | null; createdAt: Date | string; actorEmail: string | null };
