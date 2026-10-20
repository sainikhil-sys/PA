"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

type Opt = { id: string; title: string };
const short = (t: string) => (t.length > 60 ? `${t.slice(0, 59)}…` : t);

/** Optional task a focus session is for: today's top tasks, plus the one opened via ?focus=. */
export function FocusTaskSelect({ value, onChange, disabled, preselectId }: { value: string | null; onChange: (id: string | null) => void; disabled?: boolean; preselectId?: string | null }) {
  const { data } = useSWR<{ priorities: Opt[] }>("/api/tasks/today", fetcher);
  const top = data?.priorities ?? [];
  const missing = preselectId && data && !top.some((t) => t.id === preselectId) ? preselectId : null;
  const { data: extra } = useSWR<Opt>(missing ? `/api/tasks?id=${missing}` : null, fetcher, { revalidateOnFocus: false });
  const options = extra && !top.some((t) => t.id === extra.id) ? [extra, ...top] : top;
  // Keep a linked task selectable even before the lists load.
  const known = !value || options.some((o) => o.id === value);

  return (
    <select
      aria-label="Working on"
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      className="h-11 w-full min-w-0 rounded-[10px] border border-border bg-background px-2 text-[13px] text-foreground disabled:opacity-60"
    >
      <option value="">No task</option>
      {!known ? <option value={value!}>Linked task</option> : null}
      {options.map((t) => (
        <option key={t.id} value={t.id}>
          {short(t.title)}
        </option>
      ))}
    </select>
  );
}
