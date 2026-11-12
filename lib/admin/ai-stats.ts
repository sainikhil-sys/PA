import "server-only";
import { sql } from "drizzle-orm";
import { effectiveDailyLimit, utcDayStart } from "@/lib/ai/limits";
import { AI_CAPABILITIES } from "@/lib/ai/messages";
import { CONFIG, priceTableSchema, resolveValues } from "@/lib/config/registry";
import { listConfigRows } from "@/lib/config/store";
import { configuredProviders } from "@/lib/ai/providers";
import { db, rowsOf, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { errorRate, estimateCost, type ModelUsage, type PriceTable } from "./ai-cost";
import { dailySeries } from "./stats";

/**
 * Numbers for the console's AI page. Admin console only: provider and model names are allowed here
 * and nowhere user-facing. Never returns a key value, only whether each one is set.
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export type ProviderHealth = { provider: string; keySource: string; calls24h: number; failed24h: number; rate24h: number | null; calls7d: number; failed7d: number; rate7d: number | null };

/** Calls and failures per provider in the last 24 hours and 7 days, from ai_runs. */
export async function providerHealth(): Promise<ProviderHealth[]> {
  const d1 = daysAgo(1);
  const d7 = daysAgo(7);
  const r = schema.aiRuns;
  const rows = rowsOf<{ provider: string; key_source: string; calls1: number; failed1: number; calls7: number; failed7: number }>(
    await db().execute(sql`
      select ${r.provider} as provider, ${r.keySource} as key_source,
        (count(*) filter (where ${r.createdAt} >= ${d1}::timestamptz))::int as calls1,
        (count(*) filter (where ${r.createdAt} >= ${d1}::timestamptz and not ${r.ok}))::int as failed1,
        count(*)::int as calls7,
        (count(*) filter (where not ${r.ok}))::int as failed7
      from ${r}
      where ${r.createdAt} >= ${d7}::timestamptz
      group by 1, 2
      order by 5 desc
    `),
  );
  return rows.map((x) => {
    const calls24h = Number(x.calls1);
    const failed24h = Number(x.failed1);
    const calls7d = Number(x.calls7);
    const failed7d = Number(x.failed7);
    return { provider: x.provider, keySource: x.key_source, calls24h, failed24h, rate24h: errorRate(failed24h, calls24h), calls7d, failed7d, rate7d: errorRate(failed7d, calls7d) };
  });
}

/** Tokens by model and key source, today (UTC) and over the last 30 days, for the cost estimate. */
export async function usageByModel(): Promise<{ today: ModelUsage[]; days30: ModelUsage[] }> {
  const start = utcDayStart().toISOString();
  const d30 = daysAgo(30);
  const r = schema.aiRuns;
  const rows = rowsOf<{ model: string; key_source: string; in_today: string | number; out_today: string | number; in30: string | number; out30: string | number }>(
    await db().execute(sql`
      select ${r.model} as model, ${r.keySource} as key_source,
        coalesce(sum(${r.inputTokens}) filter (where ${r.createdAt} >= ${start}::timestamptz), 0)::bigint as in_today,
        coalesce(sum(${r.outputTokens}) filter (where ${r.createdAt} >= ${start}::timestamptz), 0)::bigint as out_today,
        coalesce(sum(${r.inputTokens}), 0)::bigint as in30,
        coalesce(sum(${r.outputTokens}), 0)::bigint as out30
      from ${r}
      where ${r.createdAt} >= ${d30}::timestamptz
      group by 1, 2
    `),
  );
  return {
    today: rows.map((x) => ({ model: x.model, keySource: x.key_source, input: Number(x.in_today), output: Number(x.out_today) })),
    days30: rows.map((x) => ({ model: x.model, keySource: x.key_source, input: Number(x.in30), output: Number(x.out30) })),
  };
}

/** How many accounts use their own AI key (their calls are not on Cowork's bill). */
export async function ownKeyAccounts(): Promise<number> {
  const [row] = rowsOf<{ n: number }>(await db().execute(sql`select count(*)::int as n from ${schema.userSettings} where ${schema.userSettings.aiProvider} is not null`));
  return Number(row?.n ?? 0);
}

export type SecretStatus = { name: string; label: string; set: boolean };

/** Which AI-related server secrets are set. Yes or no only: the value never leaves the server. */
export function aiSecrets(): SecretStatus[] {
  const e = env();
  return [
    { name: "AI_API_KEY", label: "Primary provider key", set: Boolean(e.AI_API_KEY) },
    { name: "AI_FALLBACK_API_KEY", label: "Fallback provider key", set: Boolean(e.AI_FALLBACK_API_KEY) },
    { name: "STT_API_KEY", label: "Speech-to-text key", set: Boolean(e.STT_API_KEY) },
    { name: "TTS_API_KEY", label: "Text-to-speech key", set: Boolean(e.TTS_API_KEY) },
    { name: "TAVILY_API_KEY", label: "Web search key", set: Boolean(e.TAVILY_API_KEY) },
    { name: "ENCRYPTION_KEY", label: "Encryption key for people's own AI keys", set: Boolean(e.ENCRYPTION_KEY) },
  ];
}

/** Server providers in fallback order, with their models and host. No key values. */
export function providerList() {
  return configuredProviders().map((p, i) => ({
    order: i + 1,
    name: p.name,
    host: new URL(p.baseURL).host,
    fastModel: p.fastModel,
    smartModel: p.smartModel,
    embeddingModel: p.embeddingModel ?? null,
    keySet: Boolean(p.apiKey),
  }));
}

/** The AI keys as stored now (uncached, so the console shows a change at once). */
export async function aiControls() {
  const rows = await listConfigRows();
  const values = resolveValues(rows);
  const versions = new Map(rows.map((r) => [r.key, r.version]));
  const parsed = priceTableSchema.safeParse(values.get("ai.priceTable"));
  return {
    switches: AI_CAPABILITIES.map((c) => ({ key: `ai.${c}`, capability: c, label: CONFIG.get(`ai.${c}`)!.label, on: values.get(`ai.${c}`) !== false, version: versions.get(`ai.${c}`) ?? 0 })),
    dailyTokenLimitPerUser: effectiveDailyLimit(values.get("ai.dailyTokenLimitPerUser")),
    priceTable: (parsed.success ? parsed.data : {}) as PriceTable,
    values,
    rows,
  };
}

/** Everything the AI page shows, for the admin API (GET /api/admin/ai). */
export async function aiOverview() {
  const [controls, series, health, usage, ownKeys] = await Promise.all([aiControls(), dailySeries(30), providerHealth(), usageByModel(), ownKeyAccounts()]);
  return {
    switches: controls.switches.map(({ key, capability, label, on }) => ({ key, capability, label, on })),
    dailyTokenLimitPerUser: controls.dailyTokenLimitPerUser,
    perDay: series.map((d) => ({ day: d.day, tokens: d.tokens, calls: d.runs })),
    providerHealth: health,
    costEstimate: {
      note: "Estimate from the price table, server keys only.",
      today: estimateCost(usage.today, controls.priceTable),
      days30: estimateCost(usage.days30, controls.priceTable),
    },
    providers: providerList(),
    secrets: aiSecrets(),
    ownKeyAccounts: ownKeys,
  };
}
