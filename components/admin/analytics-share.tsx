import { fmt } from "@/lib/admin/format";

/** Horizontal share bars: label, a bar scaled to the largest value, and the count. Counts only. */
export function ShareBars({ rows, unit, empty }: { rows: { label: string; value: number; sub?: string }[]; unit: string; empty: string }) {
  if (!rows.length) return <p className="rounded-md border border-border p-4 text-[13px] text-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="card flex flex-col gap-2 rounded-md border border-border bg-background p-3.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-[12.5px]">
          <code className="truncate text-[12px]" title={r.label}>
            {r.label}
          </code>
          <span className="h-2 overflow-hidden rounded-[2px] bg-surface-2" aria-hidden>
            <span className="block h-full bg-foreground/80" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
          <span className="tabular text-right text-muted">
            {fmt(r.value)} {unit}
            {r.sub ? <span className="text-subtle"> · {r.sub}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
