import { RetryJob } from "@/components/admin/console-client";
import { InfraLive } from "@/components/admin/infra-live";
import { Kpi, Table } from "@/components/admin/parts";
import { requireAdmin } from "@/lib/admin/guard";
import { can } from "@/lib/admin/permissions";
import { runProbes, scrubSecrets } from "@/lib/admin/probes";
import { overviewStats, systemHealth } from "@/lib/admin/stats";
import { timeAgo } from "@/lib/utils";

export default async function ConsoleSystem() {
  const me = await requireAdmin("infra.read");
  const [probes, s, h] = await Promise.all([runProbes(), overviewStats().catch(() => null), systemHealth().catch(() => null)]);
  // Analysts read infrastructure but not people: account emails only for roles that may read users.
  const showAccounts = can(me.adminRole, "users.read");
  const canRetry = can(me.adminRole, "infra.write");
  const unavailable = <p className="rounded-md border border-border p-4 text-[13px] text-muted">Unavailable: the database didn&apos;t answer. Check the Database check above.</p>;
  return (
    <div className="flex flex-col gap-5">
      <InfraLive initial={probes} />

      {s ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Jobs waiting" value={s.jobsPending} />
          <Kpi label="Jobs running" value={s.jobsRunning} />
          <Kpi label="Dead letters" value={s.jobsDead} tone={s.jobsDead ? "bad" : undefined} />
          <Kpi label="Automation failures (7d)" value={s.autoFailed7} tone={s.autoFailed7 ? "bad" : undefined} />
        </div>
      ) : (
        unavailable
      )}

      <section>
        <h2 className="mb-2 text-[15px] font-medium">Dead letters</h2>
        {h ? (
          <Table
            empty="No failed jobs."
            head={["Job", ...(showAccounts ? ["Account"] : []), "Attempts", "Error", "When", ...(canRetry ? [""] : [])]}
            rows={h.deadJobs.map((j) => [
              <code key="t" className="text-[12px]">
                {j.type}
              </code>,
              ...(showAccounts
                ? [
                    <span key="a" className="text-muted">
                      {j.email ?? "No account"}
                    </span>,
                  ]
                : []),
              <span key="n" className="tabular">
                {j.attempts}
              </span>,
              <span key="e" className="line-clamp-2 max-w-[360px] text-[12px] text-muted">
                {scrubSecrets(j.lastError)}
              </span>,
              <span key="w" className="text-muted">
                {timeAgo(j.updatedAt)}
              </span>,
              ...(canRetry ? [<RetryJob key="r" id={j.id} />] : []),
            ])}
          />
        ) : (
          unavailable
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-medium">Failed automation runs (14 days)</h2>
        {h ? (
          <Table
            empty="No failed runs."
            head={["Automation", ...(showAccounts ? ["Account"] : []), "Status", "Error", "When"]}
            rows={h.failedRuns.map((r) => [
              <span key="n" className="font-medium">
                {showAccounts ? r.name : "Automation"}
              </span>,
              ...(showAccounts
                ? [
                    <span key="a" className="text-muted">
                      {r.email}
                    </span>,
                  ]
                : []),
              <span key="s" className="capitalize">
                {r.status}
              </span>,
              <span key="e" className="line-clamp-2 max-w-[360px] text-[12px] text-muted">
                {scrubSecrets(r.error)}
              </span>,
              <span key="w" className="text-muted">
                {timeAgo(r.createdAt)}
              </span>,
            ])}
          />
        ) : (
          unavailable
        )}
      </section>
    </div>
  );
}
