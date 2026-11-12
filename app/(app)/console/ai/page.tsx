import { ConfigRow, type ConfigItem } from "@/components/admin/config-editor";
import { TestAi } from "@/components/admin/console-client";
import { Bars, Kpi, Table } from "@/components/admin/parts";
import { estimateCost, formatRate, formatUsd } from "@/lib/admin/ai-cost";
import { aiControls, aiSecrets, ownKeyAccounts, providerHealth, providerList, usageByModel } from "@/lib/admin/ai-stats";
import { fmt } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/guard";
import { can } from "@/lib/admin/permissions";
import { dailySeries, tokenBreakdown } from "@/lib/admin/stats";
import { CONFIG_ENTRIES } from "@/lib/config/registry";

/** Admin console only: provider and model names may appear here and nowhere user-facing. */
export default async function ConsoleAi() {
  const me = await requireAdmin("ai.read");
  const [controls, series, health, usage, t, ownKeys] = await Promise.all([
    aiControls().catch(() => null),
    dailySeries(30),
    providerHealth(),
    usageByModel(),
    tokenBreakdown(),
    ownKeyAccounts(),
  ]);
  const providers = providerList();
  const secrets = aiSecrets();
  const canWrite = can(me.adminRole, "ai.write");
  const canRestore = can(me.adminRole, "config.rollback");

  const sum = (rows: { input: number; output: number }[]) => rows.reduce((a, r) => a + r.input + r.output, 0);
  const tokensToday = sum(usage.today);
  const tokens30 = sum(usage.days30);
  const calls24 = health.reduce((a, h) => a + h.calls24h, 0);
  const failed24 = health.reduce((a, h) => a + h.failed24h, 0);
  const priceTable = controls?.priceTable ?? {};
  const costToday = estimateCost(usage.today, priceTable);
  const cost30 = estimateCost(usage.days30, priceTable);
  const priced = Object.keys(priceTable).length > 0;

  const byKey = new Map((controls?.rows ?? []).map((r) => [r.key, r]));
  const items: ConfigItem[] = CONFIG_ENTRIES.filter((e) => e.group === "ai").map((e) => ({
    key: e.key,
    label: e.label,
    description: e.description,
    field: e.field,
    value: controls?.values.get(e.key) ?? e.default,
    defaultValue: e.default,
    isDefault: !byKey.has(e.key),
    version: byKey.get(e.key)?.version ?? 0,
    updatedAt: byKey.get(e.key)?.updatedAt.toISOString() ?? null,
    scope: e.scope,
    readBy: e.readBy,
    canEdit: can(me.adminRole, e.permission) && !e.secret,
  }));

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="mb-1 text-[15px] font-medium">Controls</h2>
        <p className="mb-2 text-[12.5px] text-muted">
          Switches and the daily limit apply to everyone, admins included, within about 30 seconds. People see a plain &quot;not available right now&quot; message, never a provider name or
          this console. The provider test below is not affected. Every change needs a reason and is kept in the history and the audit log.
        </p>
        {controls ? (
          <ul className="card divide-y divide-border rounded-[14px] border border-border bg-background">
            {items.map((i) => (
              <ConfigRow key={i.key} item={i} canRestore={canRestore} />
            ))}
          </ul>
        ) : (
          <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">Controls unavailable: the database couldn&apos;t be read. Try again in a moment.</p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Tokens today (UTC)" value={tokensToday} sub={controls?.dailyTokenLimitPerUser ? `Limit ${fmt(controls.dailyTokenLimitPerUser)} per person` : "No daily limit per person"} />
        <Kpi label="Tokens (30 days)" value={tokens30} />
        <Kpi
          label="Error rate (24 hours)"
          value={formatRate(calls24 ? failed24 / calls24 : null)}
          sub={`${fmt(failed24)} of ${fmt(calls24)} calls failed`}
          tone={calls24 && failed24 / calls24 > 0.1 ? "bad" : undefined}
        />
        <Kpi
          label="Estimated cost (30 days)"
          value={priced ? formatUsd(cost30.totalUsd) : "No prices"}
          sub={priced ? `Estimate. Today ${formatUsd(costToday.totalUsd)}${cost30.unpriced.length ? `, ${cost30.unpriced.length} unpriced` : ""}` : "Add prices to the price table"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bars label="Tokens per day" data={series.map((d) => ({ day: d.day, value: d.tokens }))} />
        <Bars label="Calls per day" data={series.map((d) => ({ day: d.day, value: d.runs }))} />
      </div>

      <section>
        <h2 className="mb-2 text-[15px] font-medium">Error rate by provider</h2>
        <Table
          empty="No AI calls in the last 7 days."
          head={["Provider", "Calls (24 hours)", "Failed (24 hours)", "Calls (7 days)", "Failed (7 days)"]}
          rows={health.map((h) => [
            <span key="p">{h.keySource === "own" ? "People's own keys" : h.provider}</span>,
            <span key="c1" className="tabular">
              {fmt(h.calls24h)}
            </span>,
            <span key="f1" className={h.rate24h && h.rate24h > 0.1 ? "tabular text-danger" : "tabular"}>
              {formatRate(h.rate24h)}
              {h.failed24h ? <span className="text-muted"> ({fmt(h.failed24h)})</span> : null}
            </span>,
            <span key="c7" className="tabular">
              {fmt(h.calls7d)}
            </span>,
            <span key="f7" className={h.rate7d && h.rate7d > 0.1 ? "tabular text-danger" : "tabular"}>
              {formatRate(h.rate7d)}
              {h.failed7d ? <span className="text-muted"> ({fmt(h.failed7d)})</span> : null}
            </span>,
          ])}
        />
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-medium">Server providers</h2>
        <p className="mb-2 text-[12.5px] text-muted">Tried in this order: the next one takes over when one fails. Set on the server, not here.</p>
        <Table
          empty="No server provider configured, so AI features are unavailable."
          head={["Order", "Provider", "Fast", "Smart", "Embeddings", "Key", ""]}
          rows={providers.map((p) => [
            <span key="o" className="tabular">
              {p.order}
            </span>,
            <span key="p">
              {p.name} <span className="text-muted">· {p.host}</span>
            </span>,
            <code key="f" className="text-[12px]">
              {p.fastModel}
            </code>,
            <code key="s" className="text-[12px]">
              {p.smartModel}
            </code>,
            <code key="e" className="text-[12px]">
              {p.embeddingModel ?? "None"}
            </code>,
            <span key="k" className={p.keySet ? "" : "text-muted"}>
              {p.keySet ? "Set" : "Not set"}
            </span>,
            canWrite ? (
              <TestAi key="t" name={p.name} />
            ) : (
              <span key="t" className="text-[12px] text-subtle">
                Testing needs AI write access
              </span>
            ),
          ])}
        />
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-medium">Server keys</h2>
        <p className="mb-2 text-[12.5px] text-muted">Whether each key is set on the server. Values are never shown or entered here.</p>
        <Table
          head={["Key", "Used for", "Status"]}
          rows={secrets.map((s) => [
            <code key="n" className="text-[12px]">
              {s.name}
            </code>,
            <span key="l">{s.label}</span>,
            <span key="s" className={s.set ? "" : "text-muted"}>
              {s.set ? "Set" : "Missing"}
            </span>,
          ])}
        />
        <p className="mt-2 text-[12.5px] text-muted">
          {ownKeys === 1 ? "1 account uses its own AI key" : `${fmt(ownKeys)} accounts use their own AI key`}. Those calls are not on the server&apos;s bill and don&apos;t count toward the daily
          limit.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-medium">Estimated cost by model (30 days)</h2>
        <p className="mb-2 text-[12.5px] text-muted">An estimate from the price table, for server keys only. It is not a bill.</p>
        <Table
          empty="No calls on server keys in the last 30 days."
          head={["Model", "Input", "Output", "Estimated cost"]}
          rows={cost30.byModel.map((m) => [
            <code key="m" className="text-[12px]">
              {m.model}
            </code>,
            <span key="i" className="tabular">
              {fmt(m.input)}
            </span>,
            <span key="o" className="tabular">
              {fmt(m.output)}
            </span>,
            <span key="c" className={m.usd === null ? "text-muted" : "tabular"}>
              {m.usd === null ? "No price" : formatUsd(m.usd)}
            </span>,
          ])}
        />
      </section>

      <section>
        <h2 className="mb-2 text-[15px] font-medium">By model (30 days)</h2>
        <Table
          head={["Model", "Key", "Calls", "Input", "Output", "Total"]}
          rows={t.byModel.map((m) => [
            <code key="m" className="text-[12px]">
              {m.model}
            </code>,
            <span key="k" className="text-muted">
              {m.keySource === "own" ? "user key" : m.provider}
            </span>,
            <span key="c" className="tabular">
              {fmt(m.runs)}
            </span>,
            <span key="i" className="tabular">
              {fmt(m.input)}
            </span>,
            <span key="o" className="tabular">
              {fmt(m.output)}
            </span>,
            <span key="t" className="tabular font-medium">
              {fmt(m.input + m.output)}
            </span>,
          ])}
        />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-[15px] font-medium">Top accounts (30 days)</h2>
          <Table
            head={["Account", "Calls", "Tokens"]}
            rows={t.byUser.map((u) => [
              <span key="e" className="truncate">
                {u.email}
              </span>,
              <span key="c" className="tabular">
                {fmt(u.runs)}
              </span>,
              <span key="t" className="tabular">
                {fmt(u.input + u.output)}
              </span>,
            ])}
          />
        </section>
        <section>
          <h2 className="mb-2 text-[15px] font-medium">By feature (30 days)</h2>
          <Table
            head={["Feature", "Calls", "Tokens"]}
            rows={t.byKind.map((k) => [
              <code key="k" className="text-[12px]">
                {k.kind}
              </code>,
              <span key="c" className="tabular">
                {fmt(k.runs)}
              </span>,
              <span key="t" className="tabular">
                {fmt(k.input + k.output)}
              </span>,
            ])}
          />
        </section>
      </div>
      <p className="text-[12px] text-subtle">Token counting started with an earlier update; older calls show as 0.</p>
    </div>
  );
}
