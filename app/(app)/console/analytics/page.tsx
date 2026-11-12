import { ShareBars } from "@/components/admin/analytics-share";
import { Bars, Kpi, Table } from "@/components/admin/parts";
import { analyticsSummary } from "@/lib/admin/analytics";
import { requireAdmin } from "@/lib/admin/guard";

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "No data");

export default async function ConsoleAnalytics() {
  await requireAdmin("analytics.read");
  const a = await analyticsSummary().catch(() => null);
  if (!a) {
    return <p className="rounded-md border border-border p-4 text-[13px] text-muted">Analytics are unavailable: the database didn&apos;t answer. Try again in a minute.</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-label="People">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Active today" value={a.active.day} />
          <Kpi label="Active this week" value={a.active.week} />
          <Kpi label="Active in 30 days" value={a.active.month} sub={`${pct(a.active.day, a.active.month)} came back today`} />
          <Kpi label="Sign-ups (7d)" value={a.signups.week} sub={`${a.signups.month} in 30 days`} />
          <Kpi label="Conversations (7d)" value={a.conversations.week} sub={`${a.conversations.month} in 30 days`} />
          <Kpi label="Messages (7d)" value={a.conversations.messagesWeek} />
        </div>
        <p className="text-[11.5px] text-subtle">
          Active counts use the last time each signed-in device was used, so earlier days can&apos;t be rebuilt from them. {a.signups.total.toLocaleString("en-US")} accounts in total.
        </p>
      </section>

      <div className="grid gap-2 lg:grid-cols-2">
        <Bars label="Sign-ups per day" data={a.signups.daily} />
        <Bars label="New conversations per day" data={a.conversations.daily} />
      </div>

      <section className="flex flex-col gap-2" aria-label="AI use">
        <h2 className="text-[15px] font-medium">AI use (30 days)</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Calls" value={a.ai.calls30} sub={`${a.ai.failed30} failed (${pct(a.ai.failed30, a.ai.calls30)})`} tone={a.ai.calls30 && a.ai.failed30 / a.ai.calls30 > 0.1 ? "bad" : undefined} />
          <Kpi label="Tokens" value={a.ai.tokens30} />
          <Kpi label="Input tokens" value={a.ai.input30} />
          <Kpi label="Output tokens" value={a.ai.output30} />
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          <Bars label="Tokens per day" data={a.ai.dailyTokens} />
          <Bars label="AI calls per day" data={a.ai.dailyCalls} />
        </div>
        <ShareBars rows={a.ai.byFeature.map((f) => ({ label: f.feature, value: f.calls, sub: `${f.tokens.toLocaleString("en-US")} tokens` }))} unit="calls" empty="No AI calls in the last 30 days." />
      </section>

      <section className="flex flex-col gap-2" aria-label="Feature adoption">
        <h2 className="text-[15px] font-medium">Feature adoption (30 days)</h2>
        <p className="text-[12.5px] text-muted">People who used each tool at least once, from the activity log. Tool names only.</p>
        <ShareBars rows={a.features.map((f) => ({ label: f.tool, value: f.users, sub: `${f.uses.toLocaleString("en-US")} uses` }))} unit="people" empty="No tool use recorded in the last 30 days." />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-2" aria-label="Retention">
          <h2 className="text-[15px] font-medium">Second-week return</h2>
          <div className="card rounded-md border border-border bg-background p-3.5 text-[13px]">
            {a.retention.cohort ? (
              <p>
                Of <span className="tabular font-medium">{a.retention.cohort}</span> people who signed up 8 to 35 days ago, <span className="tabular font-medium">{a.retention.returned}</span> ({pct(a.retention.returned, a.retention.cohort)}) used Cowork again a week or more after signing up.
              </p>
            ) : (
              <p className="text-muted">No one signed up 8 to 35 days ago, so there is nothing to measure yet.</p>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-2" aria-label="Weekly sign-ups">
          <h2 className="text-[15px] font-medium">Sign-ups by week (12 weeks)</h2>
          <Table
            head={["Week starting", "Sign-ups"]}
            rows={a.signups.weekly.map((w) => [
              <span key="w" className="tabular">
                {w.week}
              </span>,
              <span key="n" className="tabular">
                {w.value}
              </span>,
            ])}
            empty="No sign-ups in the last 12 weeks."
          />
        </section>
      </div>

      <section className="flex flex-col gap-2" aria-label="Release adoption">
        <h2 className="text-[15px] font-medium">Release adoption (30 days)</h2>
        {a.releases.rows.length ? (
          <Table
            head={["Platform", "Version", "Build", "Runtime", "People", "Sessions"]}
            rows={a.releases.rows.map((r) => [
              r.platform === "android" ? "Android app" : r.platform === "web" ? "Web" : r.platform || "Unknown",
              <span key="v" className="tabular">
                {r.appVersion ?? "Not sent"}
              </span>,
              <span key="b" className="tabular">
                {r.appBuild ?? ""}
              </span>,
              <code key="r" className="text-[11.5px] text-muted">
                {r.runtimeVersion ?? ""}
              </code>,
              <span key="u" className="tabular">
                {r.users}
              </span>,
              <span key="s" className="tabular">
                {r.sessions}
              </span>,
            ])}
          />
        ) : (
          <p className="rounded-md border border-border p-4 text-[13px] text-muted">No app has reported its version yet. This fills in once a build that sends version headers is in use.</p>
        )}
        {a.releases.unreported.users ? (
          <p className="text-[12px] text-subtle">
            {a.releases.unreported.users.toLocaleString("en-US")} {a.releases.unreported.users === 1 ? "person" : "people"} used Cowork without sending a version (older app builds and the website).
          </p>
        ) : null}
      </section>
    </div>
  );
}
