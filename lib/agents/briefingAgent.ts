import "server-only";
import { and, asc, eq, isNotNull, lte, ne } from "drizzle-orm";
import { generateObject } from "@/lib/ai/router";
import { renderPrompt, UNTRUSTED_CONTENT_RULES } from "@/lib/ai/prompts";
import { db, schema } from "@/lib/db";
import type { BriefingContent, User } from "@/lib/db/schema";
import { getBriefingForDate } from "@/lib/db/queries/briefings";
import { listImportantEmails } from "@/lib/db/queries/emails";
import { getSettings } from "@/lib/db/queries/settings";
import { listEvents } from "@/lib/integrations/calendar";
import { formatTime, localDayBounds } from "@/lib/time";
import { log, errMessage } from "@/lib/log";
import { briefingSchema } from "./schemas";

const SYSTEM = `You write concise daily briefings. Output only JSON.\n\n${UNTRUSTED_CONTENT_RULES}`;

/**
 * Generate today's briefing. Idempotent: if a briefing for the user's local
 * date already exists it is returned unchanged (unless force = true).
 */
export async function generateDailyBriefing(user: User, opts: { force?: boolean } = {}) {
  const settings = await getSettings(user.id);
  const tz = settings.timezone;
  const { start, end, date } = localDayBounds(tz, 0);

  if (!opts.force) {
    const existing = await getBriefingForDate(user.id, date);
    if (existing) return { briefing: existing, created: false };
  }

  let meetings: BriefingContent["meetings"] = [];
  try {
    meetings = (await listEvents(user.id, start, end)).map((e) => ({
      title: e.title,
      start: e.start,
      end: e.end,
      location: e.location,
    }));
  } catch (err) {
    log.warn("briefing.calendar_failed", { error: errMessage(err) });
  }

  const important = await listImportantEmails(user.id, 8);
  const deadlines = await db()
    .select({ title: schema.tasks.title, due: schema.tasks.dueDate })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.userId, user.id),
        ne(schema.tasks.status, "done"),
        isNotNull(schema.tasks.dueDate),
        lte(schema.tasks.dueDate, localDayBounds(tz, 7).date),
      ),
    )
    .orderBy(asc(schema.tasks.dueDate))
    .limit(10);

  const content: BriefingContent = {
    headline: "",
    summary: "",
    priorities: [],
    meetings,
    emails: important.map((e) => ({
      id: e.id,
      subject: e.subject,
      from: e.fromName ?? e.fromEmail ?? "Unknown",
      category: e.category ?? "FYI",
      summary: e.summary ?? e.snippet,
    })),
    deadlines: deadlines.map((d) => ({ title: d.title, due: d.due ?? "" })),
  };

  let model: string | null = null;
  try {
    const prompt = renderPrompt("daily-briefing", {
      owner_name: user.name ?? "the owner",
      today: date,
      timezone: tz,
      meetings: meetings.length
        ? meetings.map((m) => `- ${m.start.length > 10 ? formatTime(m.start, tz) : "All day"} ${m.title}`).join("\n")
        : "- none",
      // Summaries originate from untrusted email; wrap them as data.
      emails: content.emails.length
        ? `<email_content>\n${content.emails.map((e) => `- [${e.category}] ${e.from}: ${e.summary}`).join("\n")}\n</email_content>`
        : "- none",
      tasks: content.deadlines.length ? content.deadlines.map((d) => `- ${d.title} (due ${d.due})`).join("\n") : "- none",
    });
    const result = await generateObject({ kind: "daily_briefing", userId: user.id, tier: "smart", system: SYSTEM, prompt, schema: briefingSchema });
    content.headline = result.value.headline;
    content.summary = result.value.summary;
    content.priorities = result.value.priorities;
    model = result.model;
  } catch (err) {
    // Degrade gracefully: a factual briefing without AI prose is still useful.
    log.warn("briefing.ai_failed", { error: errMessage(err) });
    content.headline = `${meetings.length} meeting${meetings.length === 1 ? "" : "s"} and ${important.length} important email${important.length === 1 ? "" : "s"} today.`;
    content.summary = "AI summary unavailable. The facts below are up to date.";
  }

  const [row] = await db()
    .insert(schema.briefings)
    .values({ userId: user.id, date, content, model })
    .onConflictDoUpdate({
      target: [schema.briefings.userId, schema.briefings.date],
      set: { content, model, createdAt: new Date() },
    })
    .returning();
  return { briefing: row!, created: true };
}
