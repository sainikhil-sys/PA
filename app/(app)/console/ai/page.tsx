import { TestAi } from "@/components/admin/console-client";
import { Bars, Kpi, Table } from "@/components/admin/parts";
import { fmt } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/guard";
import { dailySeries, overviewStats, tokenBreakdown } from "@/lib/admin/stats";
import { configuredProviders } from "@/lib/ai/providers";

export default async function ConsoleAi() {
  await requireAdmin();
  const [s, series, t] = await Promise.all([overviewStats(), dailySeries(30), tokenBreakdown()]);
  const providers = configuredProviders();
  const ownTokens = t.byModel.filter((m) => m.keySource === "own").reduce((a, m) => a + m.input + m.output, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Tokens today" value={s.tokensToday} />
        <Kpi label="Tokens (30d)" value={s.tokens30} />
        <Kpi label="AI calls (7d)" value={s.aiOk7 + s.aiFailed7} sub={`${s.aiFailed7} failed`} />
        <Kpi label="On users' own keys (30d)" value={ownTokens} sub="tokens not on your bill" />
      </div>
      <Bars label="Tokens per day" data={series.map((d) => ({ day: d.day, value: d.tokens }))} />
      <section>
        <h2 className="mb-2 text-[15px] font-medium">Server models</h2>
        <Table
          empty="No server provider configured."
          head={["Order", "Provider", "Fast", "Smart", "Embeddings", ""]}
          rows={providers.map((p, i) => [
            <span key="o" className="tabular">{i + 1}</span>,
            <span key="p">
              {p.name} <span className="text-muted">· {new URL(p.baseURL).host}</span>
            </span>,
            <code key="f" className="text-[12px]">{p.fastModel}</code>,
            <code key="s" className="text-[12px]">{p.smartModel}</code>,
            <code key="e" className="text-[12px]">{p.embeddingModel ?? "—"}</code>,
            <TestAi key="t" name={p.name} />,
          ])}
        />
      </section>
      <section>
        <h2 className="mb-2 text-[15px] font-medium">By model (30 days)</h2>
        <Table
          head={["Model", "Key", "Calls", "Input", "Output", "Total"]}
          rows={t.byModel.map((m) => [
            <code key="m" className="text-[12px]">{m.model}</code>,
            <span key="k" className="text-muted">{m.keySource === "own" ? "user key" : m.provider}</span>,
            <span key="c" className="tabular">{fmt(m.runs)}</span>,
            <span key="i" className="tabular">{fmt(m.input)}</span>,
            <span key="o" className="tabular">{fmt(m.output)}</span>,
            <span key="t" className="tabular font-medium">{fmt(m.input + m.output)}</span>,
          ])}
        />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-[15px] font-medium">Top accounts (30 days)</h2>
          <Table
            head={["Account", "Calls", "Tokens"]}
            rows={t.byUser.map((u) => [<span key="e" className="truncate">{u.email}</span>, <span key="c" className="tabular">{fmt(u.runs)}</span>, <span key="t" className="tabular">{fmt(u.input + u.output)}</span>])}
          />
        </section>
        <section>
          <h2 className="mb-2 text-[15px] font-medium">By feature (30 days)</h2>
          <Table
            head={["Feature", "Calls", "Tokens"]}
            rows={t.byKind.map((k) => [<code key="k" className="text-[12px]">{k.kind}</code>, <span key="c" className="tabular">{fmt(k.runs)}</span>, <span key="t" className="tabular">{fmt(k.input + k.output)}</span>])}
          />
        </section>
      </div>
      <p className="text-[12px] text-subtle">Token counting started with this update; earlier calls show as 0.</p>
    </div>
  );
}
