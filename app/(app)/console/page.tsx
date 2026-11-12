import { ProbeSummary } from "@/components/admin/infra-probes";
import { Bars, Kpi, Table } from "@/components/admin/parts";
import { requireAdmin } from "@/lib/admin/guard";
import { can } from "@/lib/admin/permissions";
import { runProbes } from "@/lib/admin/probes";
import { dailySeries, overviewStats, releaseAdoption } from "@/lib/admin/stats";

function Unavailable({ what }: { what: string }) {
  return <p className="rounded-md border border-border p-4 text-[13px] text-muted">{what} unavailable: the database didn&apos;t answer. Try again in a minute.</p>;
}

export default async function ConsoleOverview() {
  const me = await requireAdmin("overview.read");
  const [probes, s, series, releases] = await Promise.all([runProbes(), overviewStats().catch(() => null), dailySeries(30).catch(() => null), releaseAdoption().catch(() => null)]);
  return (
    <div className="flex flex-col gap-4">
      <ProbeSummary probes={probes} href={can(me.adminRole, "infra.read") ? "/console/system" : undefined} />

      {s ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Users" value={s.users} sub={`${s.newUsers7} new this week`} />
          <Kpi label="Active today" value={s.active1} sub={`${s.active7} this week`} />
          <Kpi label="Tokens today" value={s.tokensToday} sub={`${s.tokens30.toLocaleString("en-US")} in 30 days`} />
          <Kpi label="AI calls (7d)" value={s.aiOk7 + s.aiFailed7} sub={`${s.aiFailed7} failed`} tone={s.aiFailed7 > s.aiOk7 * 0.1 && s.aiFailed7 > 3 ? "bad" : undefined} />
          <Kpi label="Automations (7d)" value={s.autoOk7 + s.autoFailed7} sub={`${s.autoFailed7} failed`} tone={s.autoFailed7 ? "bad" : undefined} />
          <Kpi label="Job queue" value={s.jobsPending + s.jobsRunning} sub={`${s.jobsDead} dead letters`} tone={s.jobsDead ? "bad" : undefined} />
          <Kpi label="Paired devices" value={s.devices} />
          <Kpi label="Tasks created (7d)" value={s.tasks7} />
          <Kpi label="Emails synced (7d)" value={s.emails7} />
          <Kpi label="Notifications (7d)" value={s.notifications7} />
          <Kpi label="New users (30d)" value={s.newUsers30} />
          <Kpi label="Disabled accounts" value={s.disabled} />
        </div>
      ) : (
        <Unavailable what="Numbers" />
      )}

      {series ? (
        <div className="grid gap-2 lg:grid-cols-2">
          <Bars label="Tokens per day" data={series.map((d) => ({ day: d.day, value: d.tokens }))} />
          <Bars label="Sign-ups per day" data={series.map((d) => ({ day: d.day, value: d.signups }))} />
        </div>
      ) : null}

      <section className="flex flex-col gap-2" aria-label="App versions">
        <h2 className="text-[15px] font-medium">App versions in use (30 days)</h2>
        {!releases ? (
          <Unavailable what="Versions" />
        ) : (
          <>
            {releases.rows.length ? (
              <Table
                head={["Platform", "Version", "Build", "People", "Sessions"]}
                rows={releases.rows.slice(0, 8).map((r) => [
                  r.platform === "android" ? "Android app" : r.platform === "web" ? "Web" : r.platform || "Unknown",
                  <span key="v" className="tabular">
                    {r.appVersion ?? "Not sent"}
                  </span>,
                  <span key="b" className="tabular">
                    {r.appBuild ?? ""}
                  </span>,
                  <span key="u" className="tabular">
                    {r.users}
                  </span>,
                  <span key="s" className="tabular">
                    {r.sessions}
                  </span>,
                ])}
              />
            ) : (
              <p className="rounded-md border border-border p-4 text-[13px] text-muted">
                No app has reported its version yet. The current Android build and the website don&apos;t send version headers, so this stays empty until a build that sends them is in use.
              </p>
            )}
            {releases.unreported.users ? (
              <p className="text-[12px] text-subtle">
                {releases.unreported.users.toLocaleString("en-US")} {releases.unreported.users === 1 ? "person" : "people"} used Cowork in the last 30 days without sending a version.
              </p>
            ) : null}
          </>
        )}
      </section>

      {s ? (
        <section className="flex flex-col gap-2" aria-label="Connected integrations">
          <h2 className="text-[15px] font-medium">Connected integrations</h2>
          {s.integrations.length ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {s.integrations.map((i) => (
                <li key={i.provider} className="flex items-baseline justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-[13px]">
                  <span className="truncate capitalize">{i.provider}</span>
                  <span className="tabular text-muted">{i.n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-border p-4 text-[13px] text-muted">No one has connected an integration yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
