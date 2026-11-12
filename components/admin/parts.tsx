"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { fmt } from "@/lib/admin/format";
import { cn } from "@/lib/utils";

/** `tabs`: the pages this account's role may open, decided on the server (lib/admin/nav.ts). */
export function ConsoleNav({ tabs }: { tabs: readonly { href: string; label: string }[] }) {
  const path = usePathname();
  const active = tabs.slice().reverse().find((t) => path === t.href || (t.href !== "/console" && path.startsWith(t.href)))?.href ?? "/console";
  return (
    <nav aria-label="Console" className="no-scrollbar -mx-3 mb-4 flex gap-1 overflow-x-auto border-b border-border px-3 sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active === t.href ? "page" : undefined}
          className={cn("shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors", active === t.href ? "border-foreground font-medium" : "border-transparent text-muted hover:text-foreground")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "bad" | "good" }) {
  return (
    <div className="card rounded-[14px] border border-border bg-background p-3.5">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={cn("tabular mt-1 text-[24px] font-medium leading-none tracking-[-0.02em]", tone === "bad" && "text-danger")}>{typeof value === "number" ? fmt(value) : value}</p>
      {sub ? <p className="mt-1.5 truncate text-[11.5px] text-subtle">{sub}</p> : null}
    </div>
  );
}

/** Minimal bar chart (SVG, no library). */
export function Bars({ data, label, height = 120 }: { data: { day: string; value: number }[]; label: string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / data.length;
  return (
    <figure className="card rounded-[14px] border border-border bg-background p-3.5">
      <figcaption className="mb-2 flex items-baseline justify-between text-[12px] text-muted">
        <span>{label}</span>
        <span className="tabular">peak {fmt(max)}</span>
      </figcaption>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-[120px] w-full" role="img" aria-label={`${label}, last ${data.length} days`}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 4);
          return (
            <rect key={d.day} x={i * w + w * 0.15} y={height - h} width={w * 0.7} height={Math.max(h, d.value ? 1.5 : 0.6)} rx={0.6} fill="var(--foreground)" opacity={d.value ? 0.85 : 0.15}>
              <title>{`${d.day}: ${d.value.toLocaleString()}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10.5px] text-subtle">
        <span>{data[0]?.day.slice(5)}</span>
        <span>{data.at(-1)?.day.slice(5)}</span>
      </div>
    </figure>
  );
}

export function Table({ head, rows, empty = "Nothing here." }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">{empty}</p>;
  return (
    <div className="card overflow-x-auto rounded-[14px] border border-border bg-background">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead className="border-b border-border text-[12px] text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-middle">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
