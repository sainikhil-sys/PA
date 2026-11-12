import "server-only";
import { sql } from "drizzle-orm";
import { configuredProviders } from "@/lib/ai/providers";
import { db, rowsOf, schema } from "@/lib/db";
import { mailConfigured } from "@/lib/email/send";
import { fcmConfigured } from "@/lib/fcm";
import { pushConfigured } from "@/lib/push";

/**
 * Live infrastructure probes, measured when the console asks (docs/ADMIN_CONSOLE_PROPOSAL.md 5.1).
 * Every value shown is built from fixed text and numbers. Error messages are never passed through:
 * a failure is classified into a short fixed reason, so a connection string, key or host in an
 * exception can't reach the page or a response.
 */

export type ProbeStatus = "working" | "degraded" | "unavailable";

export type ProbeResult = {
  id: "database" | "jobs" | "ai" | "traces" | "mail" | "push";
  label: string;
  status: ProbeStatus;
  /** Short headline value, e.g. "84 ms" or "3 waiting". "Unavailable" when the probe failed. */
  value: string;
  /** One plain sentence. */
  detail: string;
  /** How long the probe took. */
  ms: number;
  measuredAt: string;
};

const TIMEOUT_MS = 5_000;
/** A round trip slower than this counts as degraded (the database is in another region). */
export const DB_SLOW_MS = 800;
/** A due job waiting longer than this means the dispatcher isn't keeping up. */
export const BACKLOG_STALE_MS = 15 * 60_000;

class ProbeTimeout extends Error {}

/** Fixed, secret-free reason for a failed probe. The original error is never shown. */
export function probeReason(err: unknown): string {
  if (err instanceof ProbeTimeout) return "No answer within 5 seconds.";
  const code = typeof err === "object" && err && "code" in err ? String((err as { code: unknown }).code) : "";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|CONNECT_TIMEOUT/.test(code)) return "Couldn't connect to the database.";
  if (code === "28P01" || code === "28000") return "The database refused the server's sign-in.";
  if (/^42/.test(code)) return "The query didn't match the database. A migration may be missing.";
  if (err instanceof Error && /DATABASE_URL/.test(err.message) && /required|missing|not set/i.test(err.message)) return "The database isn't configured on the server.";
  return "The check failed. The server log has the details.";
}

const SECRET_ENV = /(KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|SERVICE_ACCOUNT|_URL_UNPOOLED)/;

/**
 * For stored error text shown in the console (job and automation errors): removes credentials in
 * URLs, secret query parameters, bearer and API-key-looking tokens, and any configured secret value.
 */
export function scrubSecrets(text: string | null | undefined, env: Record<string, string | undefined> = process.env): string {
  if (!text) return "";
  let out = text.slice(0, 2000);
  for (const [k, v] of Object.entries(env)) {
    if (v && v.length >= 8 && SECRET_ENV.test(k)) out = out.split(v).join("[hidden]");
  }
  return out
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/@]*@/gi, "$1[hidden]@")
    .replace(/([?&](?:key|api_key|apikey|token|access_token|secret|sig|signature|password|code)=)[^&\s"']+/gi, "$1[hidden]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 [hidden]")
    .replace(/\b(sk|rk|pk|re|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}/g, "[hidden]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[hidden]");
}

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProbeTimeout()), ms);
    }),
  ]);
}

type Measured = Pick<ProbeResult, "status" | "value" | "detail">;

/** Runs one probe, timing it. A probe that throws is "Unavailable" with a fixed reason, never zero. */
export async function measure(id: ProbeResult["id"], label: string, fn: () => Promise<Measured> | Measured): Promise<ProbeResult> {
  const started = performance.now();
  try {
    const r = await withTimeout(Promise.resolve().then(fn));
    return { id, label, ...r, ms: Math.round(performance.now() - started), measuredAt: new Date().toISOString() };
  } catch (err) {
    return { id, label, status: "unavailable", value: "Unavailable", detail: probeReason(err), ms: Math.round(performance.now() - started), measuredAt: new Date().toISOString() };
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const minutes = (ms: number) => (ms < 60_000 ? "under a minute" : ms < 3_600_000 ? plural(Math.round(ms / 60_000), "minute") : plural(Math.round(ms / 3_600_000), "hour"));

// ---------- Pure judgements (unit tested) ----------

export function judgeDatabase(ms: number): Measured {
  return ms > DB_SLOW_MS
    ? { status: "degraded", value: `${ms} ms`, detail: `Answered, but slower than ${DB_SLOW_MS} ms.` }
    : { status: "working", value: `${ms} ms`, detail: "Answered a round trip." };
}

export function judgeJobs(j: { due: number; running: number; dead: number; oldestDueMs: number | null }): Measured {
  const value = `${plural(j.due, "waiting", "waiting")}, ${plural(j.dead, "dead letter")}`;
  if (j.oldestDueMs !== null && j.oldestDueMs > BACKLOG_STALE_MS) {
    return { status: "degraded", value, detail: `The oldest due job has waited ${minutes(j.oldestDueMs)}. The dispatcher may not be running.` };
  }
  if (j.dead > 0) return { status: "degraded", value, detail: `${plural(j.dead, "job")} failed every attempt. Retry them below once the cause is fixed.` };
  return { status: "working", value, detail: j.running ? `${plural(j.running, "job")} running now.` : "The queue is keeping up." };
}

export function judgeAi(a: { providers: number; calls: number; failed: number }): Measured {
  if (a.providers === 0) return { status: "unavailable", value: "Not set up", detail: "No AI provider is configured on the server, so AI features are off." };
  if (a.calls === 0) return { status: "working", value: "No calls", detail: "No AI calls in the last hour, so there is no error rate to show." };
  const rate = a.failed / a.calls;
  const value = `${Math.round(rate * 100)}% failed`;
  const detail = `${plural(a.failed, "failure")} in ${plural(a.calls, "call")} in the last hour.`;
  if (a.failed === a.calls && a.calls >= 3) return { status: "unavailable", value, detail };
  return { status: rate > 0.2 && a.failed >= 3 ? "degraded" : "working", value, detail };
}

export function judgeTraces(t: { spans: number; errors: number }): Measured {
  if (t.spans === 0) return { status: "working", value: "No runs", detail: "No traced runs in the last hour." };
  const rate = t.errors / t.spans;
  return { status: rate > 0.1 && t.errors >= 5 ? "degraded" : "working", value: plural(t.errors, "error"), detail: `${plural(t.errors, "error span")} in ${plural(t.spans, "span")} in the last hour.` };
}

// ---------- Probes ----------

const num = (v: unknown) => Number(v ?? 0);

async function probeDatabase(): Promise<Measured> {
  const started = performance.now();
  await db().execute(sql`select 1`);
  return judgeDatabase(Math.round(performance.now() - started));
}

async function probeJobs(): Promise<Measured> {
  const [r] = rowsOf<Record<string, unknown>>(
    await db().execute(sql`
      select
        count(*) filter (where ${schema.jobs.status} = 'pending' and ${schema.jobs.runAt} <= now())::int as due,
        count(*) filter (where ${schema.jobs.status} = 'running')::int as running,
        count(*) filter (where ${schema.jobs.status} = 'failed')::int as dead,
        (extract(epoch from now() - min(${schema.jobs.runAt}) filter (where ${schema.jobs.status} = 'pending' and ${schema.jobs.runAt} <= now())) * 1000)::bigint as oldest_due_ms
      from ${schema.jobs}`),
  );
  return judgeJobs({ due: num(r?.due), running: num(r?.running), dead: num(r?.dead), oldestDueMs: r?.oldest_due_ms === null || r?.oldest_due_ms === undefined ? null : num(r.oldest_due_ms) });
}

async function probeAi(): Promise<Measured> {
  const providers = configuredProviders().length;
  const [r] = rowsOf<Record<string, unknown>>(
    await db().execute(sql`
      select count(*)::int as calls, count(*) filter (where not ${schema.aiRuns.ok})::int as failed
      from ${schema.aiRuns} where ${schema.aiRuns.createdAt} >= now() - interval '1 hour'`),
  );
  return judgeAi({ providers, calls: num(r?.calls), failed: num(r?.failed) });
}

async function probeTraces(): Promise<Measured> {
  const [r] = rowsOf<Record<string, unknown>>(
    await db().execute(sql`
      select count(*)::int as spans, count(*) filter (where ${schema.traceSpans.status} = 'error')::int as errors
      from ${schema.traceSpans} where ${schema.traceSpans.startedAt} >= now() - interval '1 hour'`),
  );
  return judgeTraces({ spans: num(r?.spans), errors: num(r?.errors) });
}

function probeMail(): Measured {
  return mailConfigured()
    ? { status: "working", value: "Set up", detail: "Sign-in codes, alerts and broadcasts can be emailed." }
    : { status: "unavailable", value: "Not set up", detail: "No mail key is configured, so sign-in codes and broadcasts can't be emailed." };
}

function probePush(): Measured {
  const web = pushConfigured();
  const android = fcmConfigured();
  if (web && android) return { status: "working", value: "Set up", detail: "Web push and Android notifications are configured." };
  if (web || android) return { status: "degraded", value: web ? "Web only" : "Android only", detail: web ? "Web push works. Android notifications aren't configured." : "Android notifications work. Web push isn't configured." };
  return { status: "unavailable", value: "Not set up", detail: "Neither web push nor Android notifications are configured." };
}

/** All probes in parallel. Never throws. */
export async function runProbes(): Promise<ProbeResult[]> {
  return Promise.all([
    measure("database", "Database", probeDatabase),
    measure("jobs", "Job queue", probeJobs),
    measure("ai", "AI errors (1 hour)", probeAi),
    measure("traces", "Run errors (1 hour)", probeTraces),
    measure("mail", "Email", probeMail),
    measure("push", "Notifications", probePush),
  ]);
}

export function probeSummary(probes: ProbeResult[]): Record<ProbeStatus, number> {
  const out: Record<ProbeStatus, number> = { working: 0, degraded: 0, unavailable: 0 };
  for (const p of probes) out[p.status]++;
  return out;
}
