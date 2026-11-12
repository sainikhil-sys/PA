/**
 * Console-only AI maths: cost estimates from the price table (ai.priceTable) and error rates. Pure, so
 * it is unit tested. Model ids appear here because this is only ever shown inside the admin console.
 */

export type PriceTable = Record<string, { inputPerMillion: number; outputPerMillion: number }>;
export type ModelUsage = { model: string; keySource: string; input: number; output: number };
export type ModelCost = { model: string; input: number; output: number; usd: number | null };

/**
 * Estimated spend on the server's keys. Calls on people's own keys are left out (not on Cowork's bill).
 * Models without a price are listed in `unpriced` and count as unknown, never as zero.
 */
export function estimateCost(rows: readonly ModelUsage[], table: PriceTable): { totalUsd: number; byModel: ModelCost[]; unpriced: string[] } {
  const merged = new Map<string, { input: number; output: number }>();
  for (const r of rows) {
    if (r.keySource === "own") continue;
    const m = merged.get(r.model) ?? { input: 0, output: 0 };
    m.input += r.input;
    m.output += r.output;
    merged.set(r.model, m);
  }
  let totalUsd = 0;
  const unpriced: string[] = [];
  const byModel: ModelCost[] = [];
  for (const [model, u] of merged) {
    const p = table[model];
    if (!p) {
      if (u.input + u.output > 0) unpriced.push(model);
      byModel.push({ model, ...u, usd: null });
      continue;
    }
    const usd = (u.input / 1_000_000) * p.inputPerMillion + (u.output / 1_000_000) * p.outputPerMillion;
    totalUsd += usd;
    byModel.push({ model, ...u, usd });
  }
  byModel.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || b.input + b.output - (a.input + a.output));
  return { totalUsd, byModel, unpriced: unpriced.sort() };
}

/** Failed share of calls, or null when there were none (shown as "No calls", never 0%). */
export function errorRate(failed: number, calls: number): number | null {
  return calls > 0 ? failed / calls : null;
}

export function formatRate(rate: number | null): string {
  if (rate === null) return "No calls";
  const pct = rate * 100;
  return `${pct > 0 && pct < 0.1 ? "<0.1" : pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}
