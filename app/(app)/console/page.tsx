import { Bars, Kpi } from "@/components/admin/parts";
import { requireAdmin } from "@/lib/admin/guard";
import { dailySeries, overviewStats } from "@/lib/admin/stats";

export default async function ConsoleOverview() {
  await requireAdmin("overview.read");
  const [s, series] = await Promise.all([overviewStats(), dailySeries(30)]);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Users" value={s.users} sub={`${s.newUsers7} new this week`} />
        <Kpi label="Active today" value={s.active1} sub={`${s.active7} this week`} />
        <Kpi label="Tokens today" value={s.tokensToday} sub={`${s.tokens30.toLocaleString()} in 30 days`} />
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
      <div className="grid gap-2 lg:grid-cols-2">
        <Bars label="Tokens per day" data={series.map((d) => ({ day: d.day, value: d.tokens }))} />
        <Bars label="Sign-ups per day" data={series.map((d) => ({ day: d.day, value: d.signups }))} />
      </div>
      <div className="card rounded-[14px] border border-border bg-background p-3.5">
        <p className="mb-2 text-[12px] text-muted">Connected integrations</p>
        {s.integrations.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {s.integrations.map((i) => (
              <li key={i.provider} className="rounded-full border border-border px-2.5 py-1 text-[12px] capitalize">
                {i.provider} <span className="tabular text-muted">{i.n}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">None yet.</p>
        )}
      </div>
    </div>
  );
}
