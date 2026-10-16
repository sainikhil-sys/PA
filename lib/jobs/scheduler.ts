import "server-only";
import { and, asc, eq, isNotNull, isNull, lte, lt, or } from "drizzle-orm";
import { queueRun, emitEvent } from "@/lib/automations/events";
import { nextCronRun } from "@/lib/automations/schedule";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { getBriefingForDate } from "@/lib/db/queries/briefings";
import { getIntegration, getSettings } from "@/lib/db/queries/settings";
import { listEvents } from "@/lib/integrations/calendar";
import { isPastLocalTime, localDate } from "@/lib/time";
import { enqueue } from "./queue";

/** Time bucket so dedupe keys enqueue at most once per window across overlapping cron calls. */
export function bucket(minutes: number, at = Date.now()): number {
  return Math.floor(at / (minutes * 60_000));
}

export async function scheduleInboxSync(user: User) {
  const google = await getIntegration(user.id, "google");
  if (google?.status !== "connected") return false;
  await enqueue(user.id, "sync_inbox", {}, { dedupeKey: `sync:${user.id}:${bucket(10)}` });
  return true;
}

/** Idempotent: enqueues only after the local briefing time and only if today's briefing doesn't exist. */
export async function scheduleBriefing(user: User) {
  const s = await getSettings(user.id);
  if (!isPastLocalTime(s.timezone, s.briefingTime)) return false;
  const date = localDate(s.timezone);
  if (await getBriefingForDate(user.id, date)) return false;
  await enqueue(user.id, "daily_briefing", {}, { dedupeKey: `briefing:${user.id}:${date}` });
  return true;
}

/** Scheduled automations whose next run is due. Advances next_run_at atomically per automation. */
async function scheduleAutomations(user: User, timezone: string) {
  const now = new Date();
  const autos = await db()
    .select()
    .from(schema.automations)
    .where(and(eq(schema.automations.userId, user.id), eq(schema.automations.enabled, true)));
  let queued = 0;
  for (const a of autos) {
    if (a.trigger.type !== "schedule") continue;
    if (!a.nextRunAt) {
      await db().update(schema.automations).set({ nextRunAt: nextCronRun(a.trigger.cron, timezone, now) }).where(eq(schema.automations.id, a.id));
      continue;
    }
    if (a.nextRunAt > now) continue;
    const due = a.nextRunAt;
    // Claim: only the invocation that moves next_run_at forward queues the run.
    const claimed = await db()
      .update(schema.automations)
      .set({ nextRunAt: nextCronRun(a.trigger.cron, timezone, now) })
      .where(and(eq(schema.automations.id, a.id), eq(schema.automations.nextRunAt, due)))
      .returning({ id: schema.automations.id });
    if (claimed.length && (await queueRun(a, `schedule:${due.toISOString()}`, { type: "schedule", at: due.toISOString() }, false))) queued++;
  }
  return queued;
}

/** Calendar triggers: events starting in the next hour (only if such automations exist). */
async function scheduleCalendarTriggers(user: User) {
  const has = await db()
    .select({ id: schema.automations.id, trigger: schema.automations.trigger })
    .from(schema.automations)
    .where(and(eq(schema.automations.userId, user.id), eq(schema.automations.enabled, true)));
  if (!has.some((a) => a.trigger.type === "calendar_event")) return 0;
  const now = new Date();
  const events = await listEvents(user.id, now, new Date(now.getTime() + 60 * 60_000)).catch(() => []);
  let n = 0;
  for (const e of events) if (!e.allDay) n += await emitEvent(user.id, { type: "calendar_event", key: `${e.id}:${e.start}`, title: e.title, start: e.start, eventId: e.id });
  return n;
}

/** One knowledge source per dispatch, oldest sync first (incremental, small batches). */
async function scheduleKnowledgeSync(user: User) {
  const stale = new Date(Date.now() - 6 * 3_600_000);
  const [src] = await db()
    .select()
    .from(schema.knowledgeSources)
    .where(and(eq(schema.knowledgeSources.userId, user.id), eq(schema.knowledgeSources.included, true), or(isNull(schema.knowledgeSources.lastSyncAt), lt(schema.knowledgeSources.lastSyncAt, stale))))
    .orderBy(asc(schema.knowledgeSources.lastSyncAt))
    .limit(1);
  if (!src || ["text", "upload", "url"].includes(src.type)) return false;
  await enqueue(user.id, "knowledge_sync", { sourceId: src.id }, { dedupeKey: `ksync:${src.id}` });
  return true;
}

async function scheduleReminders(user: User) {
  const [due] = await db()
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, user.id), isNotNull(schema.tasks.remindAt), lte(schema.tasks.remindAt, new Date()), isNull(schema.tasks.reminderSentAt)))
    .limit(1);
  if (due) await enqueue(user.id, "reminders", {}, { dedupeKey: `reminders:${user.id}:${bucket(5)}` });
  return Boolean(due);
}

/** Everything the 5-minute dispatcher needs to enqueue. Each piece is idempotent. */
export async function scheduleDueWork(user: User) {
  const s = await getSettings(user.id);
  const result: Record<string, unknown> = {};
  result.inbox = await scheduleInboxSync(user);
  result.briefing = await scheduleBriefing(user);
  await enqueue(user.id, "fetch_news", {}, { dedupeKey: `news:${user.id}:${bucket(30)}` });
  if (isPastLocalTime(s.timezone, "06:00")) await enqueue(user.id, "suggest_ideas", {}, { dedupeKey: `ideas:${user.id}:${localDate(s.timezone)}` });
  result.reminders = await scheduleReminders(user);
  if (!s.automationsPaused) {
    result.automations = await scheduleAutomations(user, s.timezone);
    result.calendarTriggers = await scheduleCalendarTriggers(user);
  }
  result.knowledge = await scheduleKnowledgeSync(user);
  return result;
}
