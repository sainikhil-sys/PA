import "server-only";
import { and, count, desc, eq, gte, isNull, sql, sum } from "drizzle-orm";
import { db, rowsOf, schema } from "@/lib/db";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Headline KPIs for the admin overview, in ONE round trip (the database is far away). Counts only. */
export async function overviewStats() {
  // Raw SQL parameters must be strings (postgres-js doesn't serialize Date here).
  const d1 = daysAgo(1).toISOString();
  const d7 = daysAgo(7).toISOString();
  const d30 = daysAgo(30).toISOString();
  const [row] = rowsOf<Record<string, number | string | null>>(
    await db().execute(sql`
      select
        (select count(*) from ${schema.users})::int as users,
        (select count(*) from ${schema.users} where ${schema.users.createdAt} >= ${d7}::timestamptz)::int as new_users7,
        (select count(*) from ${schema.users} where ${schema.users.createdAt} >= ${d30}::timestamptz)::int as new_users30,
        (select count(*) from ${schema.users} where ${schema.users.disabledAt} is not null)::int as disabled,
        (select count(distinct ${schema.sessions.userId}) from ${schema.sessions} where ${schema.sessions.lastSeenAt} >= ${d1}::timestamptz)::int as active1,
        (select count(distinct ${schema.sessions.userId}) from ${schema.sessions} where ${schema.sessions.lastSeenAt} >= ${d7}::timestamptz)::int as active7,
        (select count(*) from ${schema.pushSubscriptions})::int as devices,
        (select coalesce(sum(${schema.aiRuns.inputTokens} + ${schema.aiRuns.outputTokens}), 0) from ${schema.aiRuns} where ${schema.aiRuns.createdAt} >= ${d30}::timestamptz)::bigint as tokens30,
        (select coalesce(sum(${schema.aiRuns.inputTokens} + ${schema.aiRuns.outputTokens}), 0) from ${schema.aiRuns} where ${schema.aiRuns.createdAt} >= ${d1}::timestamptz)::bigint as tokens_today,
        (select count(*) from ${schema.aiRuns} where ${schema.aiRuns.ok} and ${schema.aiRuns.createdAt} >= ${d7}::timestamptz)::int as ai_ok7,
        (select count(*) from ${schema.aiRuns} where not ${schema.aiRuns.ok} and ${schema.aiRuns.createdAt} >= ${d7}::timestamptz)::int as ai_failed7,
        (select count(*) from ${schema.automationRuns} where ${schema.automationRuns.status} = 'succeeded' and ${schema.automationRuns.createdAt} >= ${d7}::timestamptz)::int as auto_ok7,
        (select count(*) from ${schema.automationRuns} where ${schema.automationRuns.status} in ('failed','dead') and ${schema.automationRuns.createdAt} >= ${d7}::timestamptz)::int as auto_failed7,
        (select count(*) from ${schema.jobs} where ${schema.jobs.status} = 'pending')::int as jobs_pending,
        (select count(*) from ${schema.jobs} where ${schema.jobs.status} = 'running')::int as jobs_running,
        (select count(*) from ${schema.jobs} where ${schema.jobs.status} = 'failed')::int as jobs_dead,
        (select count(*) from ${schema.tasks} where ${schema.tasks.createdAt} >= ${d7}::timestamptz)::int as tasks7,
        (select count(*) from ${schema.emails} where ${schema.emails.createdAt} >= ${d7}::timestamptz)::int as emails7,
        (select count(*) from ${schema.notifications} where ${schema.notifications.createdAt} >= ${d7}::timestamptz)::int as notifications7,
        (select coalesce(json_agg(x order by x.n desc), '[]') from (select ${schema.integrations.provider} as provider, count(*)::int as n from ${schema.integrations} where ${schema.integrations.status} = 'connected' group by 1) x) as integrations
    `),
  );
  const n = (k: string) => Number(row?.[k] ?? 0);
  const integrations = (typeof row?.integrations === "string" ? JSON.parse(row.integrations) : (row?.integrations ?? [])) as { provider: string; n: number }[];
  return {
    users: n("users"),
    newUsers7: n("new_users7"),
    newUsers30: n("new_users30"),
    disabled: n("disabled"),
    active1: n("active1"),
    active7: n("active7"),
    devices: n("devices"),
    tokens30: n("tokens30"),
    tokensToday: n("tokens_today"),
    aiOk7: n("ai_ok7"),
    aiFailed7: n("ai_failed7"),
    autoOk7: n("auto_ok7"),
    autoFailed7: n("auto_failed7"),
    jobsPending: n("jobs_pending"),
    jobsRunning: n("jobs_running"),
    jobsDead: n("jobs_dead"),
    integrations,
    tasks7: n("tasks7"),
    emails7: n("emails7"),
    notifications7: n("notifications7"),
  };
}

/** Daily series for charts (last N days, zero-filled). */
export async function dailySeries(days = 30) {
  const since = daysAgo(days - 1);
  since.setUTCHours(0, 0, 0, 0);
  const [tok, signups] = await Promise.all([
    db()
      .select({ day: sql<string>`to_char(date_trunc('day', ${schema.aiRuns.createdAt}), 'YYYY-MM-DD')`, i: sum(schema.aiRuns.inputTokens), o: sum(schema.aiRuns.outputTokens), runs: count() })
      .from(schema.aiRuns)
      .where(gte(schema.aiRuns.createdAt, since))
      .groupBy(sql`1`),
    db()
      .select({ day: sql<string>`to_char(date_trunc('day', ${schema.users.createdAt}), 'YYYY-MM-DD')`, n: count() })
      .from(schema.users)
      .where(gte(schema.users.createdAt, since))
      .groupBy(sql`1`),
  ]);
  const out: { day: string; tokens: number; runs: number; signups: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const t = tok.find((x) => x.day === d);
    out.push({ day: d, tokens: Number(t?.i ?? 0) + Number(t?.o ?? 0), runs: Number(t?.runs ?? 0), signups: Number(signups.find((x) => x.day === d)?.n ?? 0) });
  }
  return out;
}

/** Token usage by model and by user (30 days). */
export async function tokenBreakdown() {
  const d30 = daysAgo(30);
  const [byModel, byUser, byKind] = await Promise.all([
    db()
      .select({ model: schema.aiRuns.model, provider: schema.aiRuns.provider, keySource: schema.aiRuns.keySource, i: sum(schema.aiRuns.inputTokens), o: sum(schema.aiRuns.outputTokens), runs: count() })
      .from(schema.aiRuns)
      .where(gte(schema.aiRuns.createdAt, d30))
      .groupBy(schema.aiRuns.model, schema.aiRuns.provider, schema.aiRuns.keySource)
      .orderBy(desc(sum(schema.aiRuns.outputTokens))),
    db()
      .select({ email: schema.users.email, i: sum(schema.aiRuns.inputTokens), o: sum(schema.aiRuns.outputTokens), runs: count() })
      .from(schema.aiRuns)
      .innerJoin(schema.users, eq(schema.users.id, schema.aiRuns.userId))
      .where(gte(schema.aiRuns.createdAt, d30))
      .groupBy(schema.users.email)
      .orderBy(desc(sql`sum(${schema.aiRuns.inputTokens}) + sum(${schema.aiRuns.outputTokens})`))
      .limit(15),
    db()
      .select({ kind: schema.aiRuns.taskKind, i: sum(schema.aiRuns.inputTokens), o: sum(schema.aiRuns.outputTokens), runs: count() })
      .from(schema.aiRuns)
      .where(gte(schema.aiRuns.createdAt, d30))
      .groupBy(schema.aiRuns.taskKind)
      .orderBy(desc(count())),
  ]);
  const n = (v: unknown) => Number(v ?? 0);
  return {
    byModel: byModel.map((r) => ({ model: r.model, provider: r.provider, keySource: r.keySource, input: n(r.i), output: n(r.o), runs: n(r.runs) })),
    byUser: byUser.map((r) => ({ email: r.email, input: n(r.i), output: n(r.o), runs: n(r.runs) })),
    byKind: byKind.map((r) => ({ kind: r.kind, input: n(r.i), output: n(r.o), runs: n(r.runs) })),
  };
}

/** Users table for the admin. */
export async function listUsersAdmin() {
  const rows = await db()
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      createdAt: schema.users.createdAt,
      disabledAt: schema.users.disabledAt,
      onboardedAt: schema.users.onboardedAt,
      lastSeen: sql<string | null>`(select max(${schema.sessions.lastSeenAt}) from ${schema.sessions} where ${schema.sessions.userId} = ${schema.users.id})`,
      integrations: sql<number>`(select count(*)::int from ${schema.integrations} where ${schema.integrations.userId} = ${schema.users.id} and ${schema.integrations.status} = 'connected')`,
      devices: sql<number>`(select count(*)::int from ${schema.pushSubscriptions} where ${schema.pushSubscriptions.userId} = ${schema.users.id})`,
      tokens30: sql<number>`(select coalesce(sum(${schema.aiRuns.inputTokens} + ${schema.aiRuns.outputTokens}), 0)::int from ${schema.aiRuns} where ${schema.aiRuns.userId} = ${schema.users.id} and ${schema.aiRuns.createdAt} > now() - interval '30 days')`,
    })
    .from(schema.users)
    .orderBy(desc(schema.users.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), disabledAt: r.disabledAt?.toISOString() ?? null, onboardedAt: r.onboardedAt?.toISOString() ?? null, lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null }));
}

/** Failed jobs (dead letters) and recent failed automation runs. */
export async function systemHealth() {
  const [deadJobs, failedRuns] = await Promise.all([
    db()
      .select({ id: schema.jobs.id, type: schema.jobs.type, attempts: schema.jobs.attempts, lastError: schema.jobs.lastError, updatedAt: schema.jobs.updatedAt, email: schema.users.email })
      .from(schema.jobs)
      .leftJoin(schema.users, eq(schema.users.id, schema.jobs.userId))
      .where(eq(schema.jobs.status, "failed"))
      .orderBy(desc(schema.jobs.updatedAt))
      .limit(50),
    db()
      .select({ id: schema.automationRuns.id, status: schema.automationRuns.status, error: schema.automationRuns.error, createdAt: schema.automationRuns.createdAt, name: schema.automations.name, email: schema.users.email })
      .from(schema.automationRuns)
      .innerJoin(schema.automations, eq(schema.automations.id, schema.automationRuns.automationId))
      .innerJoin(schema.users, eq(schema.users.id, schema.automationRuns.userId))
      .where(and(sql`${schema.automationRuns.status} in ('failed','dead')`, gte(schema.automationRuns.createdAt, daysAgo(14))))
      .orderBy(desc(schema.automationRuns.createdAt))
      .limit(50),
  ]);
  return {
    deadJobs: deadJobs.map((j) => ({ ...j, updatedAt: j.updatedAt.toISOString() })),
    failedRuns: failedRuns.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}

export async function listBroadcasts() {
  return db().select().from(schema.broadcasts).orderBy(desc(schema.broadcasts.createdAt)).limit(30);
}

/** Recipients for a broadcast: every active account. */
export async function broadcastAudience() {
  const [row] = await db().select({ n: count() }).from(schema.users).where(isNull(schema.users.disabledAt));
  return Number(row?.n ?? 0);
}
