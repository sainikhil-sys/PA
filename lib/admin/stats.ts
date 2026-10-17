import "server-only";
import { and, count, desc, eq, gte, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Headline KPIs for the admin overview. Counts only, no user content. */
export async function overviewStats() {
  const d1 = daysAgo(1);
  const d7 = daysAgo(7);
  const d30 = daysAgo(30);
  const one = async <T>(q: Promise<T[]>) => (await q)[0];
  const [users, newUsers7, newUsers30, disabled, active1, active7, devices, tokens30, tokensToday, runs7, autoRuns7, jobs, integrations, tasks7, emails7, notif7] = await Promise.all([
    one(db().select({ n: count() }).from(schema.users)),
    one(db().select({ n: count() }).from(schema.users).where(gte(schema.users.createdAt, d7))),
    one(db().select({ n: count() }).from(schema.users).where(gte(schema.users.createdAt, d30))),
    one(db().select({ n: count() }).from(schema.users).where(isNotNull(schema.users.disabledAt))),
    one(db().select({ n: sql<number>`count(distinct ${schema.sessions.userId})::int` }).from(schema.sessions).where(gte(schema.sessions.lastSeenAt, d1))),
    one(db().select({ n: sql<number>`count(distinct ${schema.sessions.userId})::int` }).from(schema.sessions).where(gte(schema.sessions.lastSeenAt, d7))),
    one(db().select({ n: count() }).from(schema.pushSubscriptions)),
    one(db().select({ i: sum(schema.aiRuns.inputTokens), o: sum(schema.aiRuns.outputTokens) }).from(schema.aiRuns).where(gte(schema.aiRuns.createdAt, d30))),
    one(db().select({ i: sum(schema.aiRuns.inputTokens), o: sum(schema.aiRuns.outputTokens) }).from(schema.aiRuns).where(gte(schema.aiRuns.createdAt, d1))),
    one(db().select({ ok: sql<number>`count(*) filter (where ${schema.aiRuns.ok})::int`, failed: sql<number>`count(*) filter (where not ${schema.aiRuns.ok})::int` }).from(schema.aiRuns).where(gte(schema.aiRuns.createdAt, d7))),
    one(
      db()
        .select({ ok: sql<number>`count(*) filter (where ${schema.automationRuns.status} = 'succeeded')::int`, failed: sql<number>`count(*) filter (where ${schema.automationRuns.status} in ('failed','dead'))::int` })
        .from(schema.automationRuns)
        .where(gte(schema.automationRuns.createdAt, d7)),
    ),
    one(
      db()
        .select({
          pending: sql<number>`count(*) filter (where ${schema.jobs.status} = 'pending')::int`,
          running: sql<number>`count(*) filter (where ${schema.jobs.status} = 'running')::int`,
          dead: sql<number>`count(*) filter (where ${schema.jobs.status} = 'failed')::int`,
        })
        .from(schema.jobs),
    ),
    db().select({ provider: schema.integrations.provider, n: count() }).from(schema.integrations).where(eq(schema.integrations.status, "connected")).groupBy(schema.integrations.provider).orderBy(desc(count())),
    one(db().select({ n: count() }).from(schema.tasks).where(gte(schema.tasks.createdAt, d7))),
    one(db().select({ n: count() }).from(schema.emails).where(gte(schema.emails.createdAt, d7))),
    one(db().select({ n: count() }).from(schema.notifications).where(gte(schema.notifications.createdAt, d7))),
  ]);
  const num = (v: unknown) => Number(v ?? 0);
  return {
    users: num(users?.n),
    newUsers7: num(newUsers7?.n),
    newUsers30: num(newUsers30?.n),
    disabled: num(disabled?.n),
    active1: num(active1?.n),
    active7: num(active7?.n),
    devices: num(devices?.n),
    tokens30: num(tokens30?.i) + num(tokens30?.o),
    tokensToday: num(tokensToday?.i) + num(tokensToday?.o),
    aiOk7: num(runs7?.ok),
    aiFailed7: num(runs7?.failed),
    autoOk7: num(autoRuns7?.ok),
    autoFailed7: num(autoRuns7?.failed),
    jobsPending: num(jobs?.pending),
    jobsRunning: num(jobs?.running),
    jobsDead: num(jobs?.dead),
    integrations: integrations.map((r) => ({ provider: r.provider, n: num(r.n) })),
    tasks7: num(tasks7?.n),
    emails7: num(emails7?.n),
    notifications7: num(notif7?.n),
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
