import { RetryJob } from "@/components/admin/console-client";
import { Kpi, Table } from "@/components/admin/parts";
import { requireAdmin } from "@/lib/admin/guard";
import { overviewStats, systemHealth } from "@/lib/admin/stats";
import { timeAgo } from "@/lib/utils";

export default async function ConsoleSystem() {
  await requireAdmin();
  const [s, h] = await Promise.all([overviewStats(), systemHealth()]);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Jobs waiting" value={s.jobsPending} />
        <Kpi label="Jobs running" value={s.jobsRunning} />
        <Kpi label="Dead letters" value={s.jobsDead} tone={s.jobsDead ? "bad" : undefined} />
        <Kpi label="Automation failures (7d)" value={s.autoFailed7} tone={s.autoFailed7 ? "bad" : undefined} />
      </div>
      <section>
        <h2 className="mb-2 text-[15px] font-medium">Dead letters</h2>
        <Table
          empty="No failed jobs."
          head={["Job", "Account", "Attempts", "Error", "When", ""]}
          rows={h.deadJobs.map((j) => [
            <code key="t" className="text-[12px]">{j.type}</code>,
            <span key="a" className="text-muted">{j.email ?? "—"}</span>,
            <span key="n" className="tabular">{j.attempts}</span>,
            <span key="e" className="line-clamp-2 max-w-[360px] text-[12px] text-muted">{j.lastError ?? ""}</span>,
            <span key="w" className="text-muted">{timeAgo(j.updatedAt)}</span>,
            <RetryJob key="r" id={j.id} />,
          ])}
        />
      </section>
      <section>
        <h2 className="mb-2 text-[15px] font-medium">Failed automation runs (14 days)</h2>
        <Table
          empty="No failed runs."
          head={["Automation", "Account", "Status", "Error", "When"]}
          rows={h.failedRuns.map((r) => [
            <span key="n" className="font-medium">{r.name}</span>,
            <span key="a" className="text-muted">{r.email}</span>,
            <span key="s" className="capitalize">{r.status}</span>,
            <span key="e" className="line-clamp-2 max-w-[360px] text-[12px] text-muted">{r.error ?? ""}</span>,
            <span key="w" className="text-muted">{timeAgo(r.createdAt)}</span>,
          ])}
        />
      </section>
    </div>
  );
}
