import "server-only";
import { sql } from "drizzle-orm";
import { db, rowsOf, schema } from "@/lib/db";
import { releaseAdoption, type ReleaseRow } from "./stats";

/**
 * Product analytics for the console (permission analytics.read, which analysts hold). Counts only:
 * no email addresses, names, message text or other content is selected, and stripPersonal runs over
 * the result as a second line of defence.
 */

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

export type DayPoint = { day: string; value: number };
export type AnalyticsSummary = {
  active: { day: number; week: number; month: number };
  signups: { week: number; month: number; total: number; daily: DayPoint[]; weekly: { week: string; value: number }[] };
  conversations: { week: number; month: number; messagesWeek: number; daily: DayPoint[] };
  ai: { calls30: number; failed30: number; tokens30: number; input30: number; output30: number; dailyTokens: DayPoint[]; dailyCalls: DayPoint[]; byFeature: { feature: string; calls: number; tokens: number }[] };
  features: { tool: string; users: number; uses: number }[];
  retention: { cohort: number; returned: number };
  releases: { rows: ReleaseRow[]; unreported: { users: number; sessions: number } };
  generatedAt: string;
};

const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;

/** Copies a value with anything that looks like an email address replaced. Analytics are counts only. */
export function stripPersonal<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === "string") {
    const out = value.replace(EMAIL, "[hidden]");
    return (out.includes("@") ? "[hidden]" : out) as T;
  }
  if (Array.isArray(value)) return value.map((v) => stripPersonal(v, depth + 1)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripPersonal(v, depth + 1)])) as T;
  }
  return value;
}

/** Identifier-like labels only (tool and feature names): anything else is shown as "other". */
export function safeLabel(v: unknown): string {
  const s = String(v ?? "").slice(0, 60);
  return /^[\w.:-]+$/.test(s) ? s : "other";
}

const n = (v: unknown) => Number(v ?? 0);

/** Zero-filled day series from rows of { day: "YYYY-MM-DD", n }. */
export function fillDays(rows: { day: unknown; n: unknown }[], days: number, now = Date.now()): DayPoint[] {
  const start = new Date(now - (days - 1) * DAY);
  start.setUTCHours(0, 0, 0, 0);
  const by = new Map(rows.map((r) => [String(r.day), n(r.n)]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(start.getTime() + i * DAY).toISOString().slice(0, 10);
    return { day, value: by.get(day) ?? 0 };
  });
}

/** Everything the Analytics page shows, in a few round trips. */
export async function analyticsSummary(): Promise<AnalyticsSummary> {
  const d1 = iso(DAY);
  const d7 = iso(7 * DAY);
  const d30 = iso(30 * DAY);
  const since30 = new Date(Date.now() - 29 * DAY);
  since30.setUTCHours(0, 0, 0, 0);
  const s30 = since30.toISOString();
  const since12w = iso(12 * 7 * DAY);
  const u = schema.users;
  const s = schema.sessions;
  const c = schema.conversations;
  const m = schema.messages;
  const ai = schema.aiRuns;
  const act = schema.activityLog;
  const day = (col: unknown) => sql`to_char(date_trunc('day', ${col}), 'YYYY-MM-DD')`;

  const [scalarRows, signupDaily, signupWeekly, convDaily, aiDaily, aiByKind, features, releases] = await Promise.all([
    db().execute(sql`
      select
        (select count(distinct ${s.userId}) from ${s} where ${s.lastSeenAt} >= ${d1}::timestamptz)::int as active_day,
        (select count(distinct ${s.userId}) from ${s} where ${s.lastSeenAt} >= ${d7}::timestamptz)::int as active_week,
        (select count(distinct ${s.userId}) from ${s} where ${s.lastSeenAt} >= ${d30}::timestamptz)::int as active_month,
        (select count(*) from ${u})::int as users_total,
        (select count(*) from ${u} where ${u.createdAt} >= ${d7}::timestamptz)::int as signups_week,
        (select count(*) from ${u} where ${u.createdAt} >= ${d30}::timestamptz)::int as signups_month,
        (select count(*) from ${c} where ${c.createdAt} >= ${d7}::timestamptz)::int as conv_week,
        (select count(*) from ${c} where ${c.createdAt} >= ${d30}::timestamptz)::int as conv_month,
        (select count(*) from ${m} where ${m.createdAt} >= ${d7}::timestamptz)::int as messages_week,
        (select count(*) from ${ai} where ${ai.createdAt} >= ${d30}::timestamptz)::int as ai_calls,
        (select count(*) from ${ai} where not ${ai.ok} and ${ai.createdAt} >= ${d30}::timestamptz)::int as ai_failed,
        (select coalesce(sum(${ai.inputTokens}), 0) from ${ai} where ${ai.createdAt} >= ${d30}::timestamptz)::bigint as ai_input,
        (select coalesce(sum(${ai.outputTokens}), 0) from ${ai} where ${ai.createdAt} >= ${d30}::timestamptz)::bigint as ai_output,
        (select count(*) from ${u} where ${u.createdAt} < now() - interval '8 days' and ${u.createdAt} >= now() - interval '35 days')::int as cohort,
        (select count(*) from ${u} where ${u.createdAt} < now() - interval '8 days' and ${u.createdAt} >= now() - interval '35 days'
          and exists (select 1 from ${s} where ${s.userId} = ${u.id} and ${s.lastSeenAt} >= ${u.createdAt} + interval '7 days'))::int as returned
    `),
    db().execute(sql`select ${day(u.createdAt)} as day, count(*)::int as n from ${u} where ${u.createdAt} >= ${s30}::timestamptz group by 1`),
    db().execute(sql`select to_char(date_trunc('week', ${u.createdAt}), 'YYYY-MM-DD') as week, count(*)::int as n from ${u} where ${u.createdAt} >= ${since12w}::timestamptz group by 1 order by 1`),
    db().execute(sql`select ${day(c.createdAt)} as day, count(*)::int as n from ${c} where ${c.createdAt} >= ${s30}::timestamptz group by 1`),
    db().execute(sql`select ${day(ai.createdAt)} as day, count(*)::int as calls, coalesce(sum(${ai.inputTokens} + ${ai.outputTokens}), 0)::bigint as tokens from ${ai} where ${ai.createdAt} >= ${s30}::timestamptz group by 1`),
    db().execute(sql`select ${ai.taskKind} as feature, count(*)::int as calls, coalesce(sum(${ai.inputTokens} + ${ai.outputTokens}), 0)::bigint as tokens from ${ai} where ${ai.createdAt} >= ${d30}::timestamptz group by 1 order by 2 desc limit 25`),
    db().execute(sql`select ${act.tool} as tool, count(distinct ${act.userId})::int as users, count(*)::int as uses from ${act} where ${act.createdAt} >= ${d30}::timestamptz group by 1 order by 2 desc, 3 desc limit 30`),
    releaseAdoption(),
  ]);

  const [r] = rowsOf<Record<string, unknown>>(scalarRows);
  const aiDays = rowsOf<Record<string, unknown>>(aiDaily);
  const summary: AnalyticsSummary = {
    active: { day: n(r?.active_day), week: n(r?.active_week), month: n(r?.active_month) },
    signups: {
      week: n(r?.signups_week),
      month: n(r?.signups_month),
      total: n(r?.users_total),
      daily: fillDays(rowsOf<{ day: unknown; n: unknown }>(signupDaily), 30),
      weekly: rowsOf<Record<string, unknown>>(signupWeekly)
        .map((w) => ({ week: String(w.week ?? ""), value: n(w.n) }))
        .filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.week)),
    },
    conversations: { week: n(r?.conv_week), month: n(r?.conv_month), messagesWeek: n(r?.messages_week), daily: fillDays(rowsOf<{ day: unknown; n: unknown }>(convDaily), 30) },
    ai: {
      calls30: n(r?.ai_calls),
      failed30: n(r?.ai_failed),
      input30: n(r?.ai_input),
      output30: n(r?.ai_output),
      tokens30: n(r?.ai_input) + n(r?.ai_output),
      dailyTokens: fillDays(aiDays.map((d) => ({ day: d.day, n: d.tokens })), 30),
      dailyCalls: fillDays(aiDays.map((d) => ({ day: d.day, n: d.calls })), 30),
      byFeature: rowsOf<Record<string, unknown>>(aiByKind).map((k) => ({ feature: safeLabel(k.feature), calls: n(k.calls), tokens: n(k.tokens) })),
    },
    features: rowsOf<Record<string, unknown>>(features).map((f) => ({ tool: safeLabel(f.tool), users: n(f.users), uses: n(f.uses) })),
    retention: { cohort: n(r?.cohort), returned: n(r?.returned) },
    releases,
    generatedAt: new Date().toISOString(),
  };
  return stripPersonal(summary);
}
