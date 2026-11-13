"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { call } from "@/components/feed/api";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";

/** One button that calls the API, optionally asks first, then refreshes or opens a page. */
export function ActionButton({
  url,
  method = "POST",
  body,
  label,
  confirm,
  done,
  variant = "secondary",
  goTo,
}: {
  url: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  label: string;
  confirm?: string;
  done?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** Open this page afterwards; "{id}" is replaced by the id the API returns. */
  goTo?: string;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (confirm && !window.confirm(confirm)) return;
          const r = await call<{ id?: string; dealId?: string }>(url, { method, body });
          if (!r.ok) return void toast.error(r.error);
          if (done) toast.success(done);
          const id = r.data?.id ?? r.data?.dealId;
          if (goTo) router.push(goTo.replace("{id}", id ?? ""));
          else router.refresh();
        })
      }
    >
      {label}
    </Button>
  );
}

export type Field = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "date" | "datetime-local" | "select";
  options?: [string, string][];
  required?: boolean;
  placeholder?: string;
  max?: number;
  /** Converts the typed value before sending (e.g. "12.50" to 1250 minor units). */
  transform?: (v: string) => unknown;
  /** Splits a comma-separated list into an array. */
  list?: boolean;
  initial?: string;
};

/** A form whose fields post to one API route. */
export function ApiForm({ url, method = "POST", fields, submit, done, extra, goTo, className }: { url: string; method?: "POST" | "PATCH" | "PUT"; fields: Field[]; submit: string; done?: string; extra?: Record<string, unknown>; goTo?: string; className?: string }) {
  const router = useRouter();
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.options?.[0]?.[0] ?? "")])));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const payload: Record<string, unknown> = { ...extra };
      for (const f of fields) {
        const raw = (values[f.name] ?? "").trim();
        if (!raw && !f.required) continue;
        payload[f.name] = f.list ? raw.split(",").map((x) => x.trim()).filter(Boolean) : f.transform ? f.transform(raw) : f.type === "number" ? Number(raw) : raw;
      }
      const r = await call<{ id?: string; dealId?: string; org?: { slug: string } }>(url, { method, body: payload });
      if (!r.ok) return setError(r.error);
      if (done) toast.success(done);
      const id = r.data?.id ?? r.data?.dealId ?? r.data?.org?.slug;
      if (goTo) router.push(goTo.replace("{id}", id ?? ""));
      else {
        setValues(Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.options?.[0]?.[0] ?? "")])));
        router.refresh();
      }
    });
  };
  return (
    <form onSubmit={submitForm} className={className ?? "card flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4"}>
      {fields.map((f) => {
        const id = `${url.replace(/\W+/g, "-")}-${f.name}`;
        const common = { id, required: f.required, value: values[f.name] ?? "", placeholder: f.placeholder, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [f.name]: e.target.value })) };
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{f.label}</Label>
            {f.type === "textarea" ? (
              <Textarea rows={3} maxLength={f.max} {...common} />
            ) : f.type === "select" ? (
              <select className="h-10 rounded-[10px] border border-border bg-background px-2 text-[14px]" {...common}>
                {f.options!.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            ) : (
              <Input type={f.type ?? "text"} maxLength={f.max} step={f.type === "number" ? "any" : undefined} {...common} />
            )}
          </div>
        );
      })}
      <FieldError>{error}</FieldError>
      <Button type="submit" variant="primary" className="self-end" disabled={pending}>
        {submit}
      </Button>
    </form>
  );
}

/** Amount typed as "1250.50" to minor units (125050). */
export const toMinor = (v: string) => Math.round(Number(v.replace(/,/g, "")) * 100);
export const toIso = (v: string) => new Date(v).toISOString();
