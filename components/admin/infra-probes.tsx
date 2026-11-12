import Link from "next/link";
import type { ProbeResult, ProbeStatus } from "@/lib/admin/probes";
import { cn } from "@/lib/utils";

/** Presentational only (no hooks), so both the server page and the client refresher render it. */

export const STATUS_LABEL: Record<ProbeStatus, string> = { working: "Working", degraded: "Degraded", unavailable: "Unavailable" };
const STATUS_TONE: Record<ProbeStatus, string> = { working: "text-success", degraded: "text-warning", unavailable: "text-danger" };
const MARK_TONE: Record<ProbeStatus, string> = { working: "bg-success", degraded: "bg-warning", unavailable: "bg-danger" };

export function StatusMark({ status }: { status: ProbeStatus }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-[2px]", MARK_TONE[status])} />;
}

function time(iso: string) {
  return new Date(iso).toISOString().slice(11, 19);
}

export function ProbeGrid({ probes }: { probes: ProbeResult[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {probes.map((p) => (
        <li key={p.id} className="card flex flex-col gap-1.5 rounded-md border border-border bg-background p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] text-muted">{p.label}</p>
            <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", STATUS_TONE[p.status])}>
              <StatusMark status={p.status} />
              {STATUS_LABEL[p.status]}
            </span>
          </div>
          <p className="tabular text-[20px] font-medium leading-none tracking-[-0.02em]">{p.value}</p>
          <p className="text-[12.5px] text-muted">{p.detail}</p>
          <p className="tabular text-[11px] text-subtle">
            Measured at {time(p.measuredAt)} UTC in {p.ms} ms
          </p>
        </li>
      ))}
    </ul>
  );
}

/** One line per probe that isn't working, for the Overview. */
export function ProbeSummary({ probes, href }: { probes: ProbeResult[]; href?: string }) {
  const bad = probes.filter((p) => p.status !== "working");
  const counts = { working: 0, degraded: 0, unavailable: 0 } as Record<ProbeStatus, number>;
  for (const p of probes) counts[p.status]++;
  const overall: ProbeStatus = counts.unavailable ? "unavailable" : counts.degraded ? "degraded" : "working";
  return (
    <section className="card flex flex-col gap-2 rounded-md border border-border bg-background p-3.5" aria-label="Health">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={cn("inline-flex items-center gap-1.5 text-[14px] font-medium", STATUS_TONE[overall])}>
          <StatusMark status={overall} />
          {overall === "working" ? "All checks working" : `${counts.unavailable + counts.degraded} of ${probes.length} checks need attention`}
        </p>
        {href ? (
          <Link href={href} className="text-[12.5px] text-muted underline-offset-4 hover:text-foreground hover:underline">
            Open Infrastructure
          </Link>
        ) : null}
      </div>
      {bad.length ? (
        <ul className="flex flex-col gap-1">
          {bad.map((p) => (
            <li key={p.id} className="flex items-start gap-2 text-[12.5px]">
              <span className={cn("mt-[3px] inline-flex items-center gap-1.5 font-medium", STATUS_TONE[p.status])}>
                <StatusMark status={p.status} />
                {p.label}
              </span>
              <span className="text-muted">{p.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[11px] text-subtle">Measured when this page opened. History isn't stored yet.</p>
    </section>
  );
}
