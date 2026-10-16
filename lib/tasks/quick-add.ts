import * as chrono from "chrono-node";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { Recurrence } from "@/lib/db/schema";

/**
 * Natural-language quick add (pure, testable). Examples:
 *   "call Ravi tomorrow at 5"            -> scheduled tomorrow 17:00
 *   "every Monday 9am review inbox"      -> weekly on Monday at 09:00
 *   "send invoice by Friday #finance !high" -> due Friday, tag finance, priority high
 */
export type QuickAddResult = {
  title: string;
  dueDate: string | null;
  scheduledAt: Date | null;
  recurrence: Recurrence | null;
  priority: number;
  tags: string[];
};

const WEEKDAYS: Record<string, number> = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };

function parseTime(s: string): string | null {
  const m = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const mer = m[3]?.toLowerCase();
  if (!mer && !m[2] && !/\bat\b/i.test(m[0])) return null; // a bare number isn't a time
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  if (!mer && h >= 1 && h <= 7) h += 12; // "at 5" almost always means 5pm
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function stripTimeWords(s: string): string {
  return s.replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, "").replace(/\bat\s+\d{1,2}(?::\d{2})?\b/gi, "");
}

function tidy(s: string): string {
  return s.replace(/\s{2,}/g, " ").replace(/^[\s,.-]+|[\s,.-]+$/g, "").replace(/\b(on|at|by|every)$/i, "").trim();
}

export function parseQuickAdd(input: string, timezone: string, now: Date = new Date()): QuickAddResult {
  let text = input.trim();
  const tags = [...text.matchAll(/(?:^|\s)#([\w-]{1,30})/g)].map((m) => m[1]!.toLowerCase());
  text = text.replace(/(?:^|\s)#[\w-]{1,30}/g, " ");

  let priority = 0;
  const pr = /(?:^|\s)(!high|!med(?:ium)?|!low|p[123])\b/i.exec(text);
  if (pr) {
    const v = pr[1]!.toLowerCase();
    priority = v === "!high" || v === "p1" ? 3 : v.startsWith("!med") || v === "p2" ? 2 : 1;
    text = text.replace(pr[0], " ");
  }

  // Recurrence: "every day", "every weekday", "every monday", "every 2 weeks", "every month"
  let recurrence: Recurrence | null = null;
  const rec = /\bevery\s+(other\s+|(\d+)\s+)?(day|weekday|week|month|sunday|sun|monday|mon|tuesday|tues?|wednesday|wed|thursday|thur?s?|friday|fri|saturday|sat)s?\b/i.exec(text);
  if (rec) {
    const interval = rec[1]?.trim() === "other" ? 2 : Number(rec[2] ?? 1);
    const unit = rec[3]!.toLowerCase();
    const time = parseTime(text) ?? undefined;
    if (unit === "day") recurrence = { freq: "daily", interval, time };
    else if (unit === "weekday") recurrence = { freq: "weekly", interval: 1, byWeekday: [1, 2, 3, 4, 5], time };
    else if (unit === "week") recurrence = { freq: "weekly", interval, byWeekday: [toZonedTime(now, timezone).getDay()], time };
    else if (unit === "month") recurrence = { freq: "monthly", interval, time };
    else recurrence = { freq: "weekly", interval, byWeekday: [WEEKDAYS[unit] ?? 1], time };
    text = stripTimeWords(text.replace(rec[0], " "));
    const next = nextOccurrence(recurrence, timezone, now);
    return { title: tidy(text) || input.trim(), dueDate: null, scheduledAt: next, recurrence, priority, tags };
  }

  // One-off dates: chrono in the user's timezone.
  const zonedNow = toZonedTime(now, timezone);
  const results = chrono.parse(text, zonedNow, { forwardDate: true });
  let dueDate: string | null = null;
  let scheduledAt: Date | null = null;
  const r = results[0];
  if (r) {
    const d = r.start;
    const y = d.get("year")!;
    const mo = String(d.get("month")!).padStart(2, "0");
    const da = String(d.get("day")!).padStart(2, "0");
    const isDeadline = /\b(by|due|before)\b/i.test(text.slice(Math.max(0, r.index - 8), r.index));
    const hasTime = d.isCertain("hour");
    if (hasTime && !isDeadline) {
      let hh = d.get("hour")!;
      if (!d.isCertain("meridiem") && hh >= 1 && hh <= 7) hh += 12;
      const mm = String(d.get("minute") ?? 0).padStart(2, "0");
      scheduledAt = fromZonedTime(`${y}-${mo}-${da}T${String(hh).padStart(2, "0")}:${mm}:00`, timezone);
    } else {
      dueDate = `${y}-${mo}-${da}`;
    }
    text = text.slice(0, r.index) + text.slice(r.index + r.text.length);
    text = text.replace(/\b(by|due|before)\s*$/i, "");
  }
  return { title: tidy(text) || input.trim(), dueDate, scheduledAt, recurrence: null, priority, tags };
}

/** Next occurrence of a recurrence strictly after `after`, in the user's timezone. */
export function nextOccurrence(rec: Recurrence, timezone: string, after: Date = new Date()): Date {
  const [hh, mm] = (rec.time ?? "09:00").split(":").map(Number) as [number, number];
  const local = toZonedTime(after, timezone);
  for (let i = 0; i < 400; i++) {
    const day = new Date(local.getFullYear(), local.getMonth(), local.getDate() + i, hh, mm, 0);
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
    const candidate = fromZonedTime(iso, timezone);
    if (candidate <= after) continue;
    if (rec.freq === "daily" && i % rec.interval === 0) return candidate;
    if (rec.freq === "weekly" && (rec.byWeekday ?? [local.getDay()]).includes(day.getDay())) {
      const weeks = Math.floor(i / 7);
      if (weeks % rec.interval === 0) return candidate;
    }
    if (rec.freq === "monthly" && day.getDate() === local.getDate()) {
      const months = (day.getFullYear() - local.getFullYear()) * 12 + day.getMonth() - local.getMonth();
      if (months % rec.interval === 0) return candidate;
    }
  }
  return new Date(after.getTime() + 86_400_000);
}

export function describeRecurrence(rec: Recurrence): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const every = rec.interval > 1 ? `Every ${rec.interval} ` : "Every ";
  const at = rec.time ? ` at ${rec.time}` : "";
  if (rec.freq === "daily") return `${every}${rec.interval > 1 ? "days" : "day"}${at}`;
  if (rec.freq === "monthly") return `${every}${rec.interval > 1 ? "months" : "month"}${at}`;
  const days = rec.byWeekday?.length === 5 && !rec.byWeekday.includes(0) && !rec.byWeekday.includes(6) ? "weekday" : (rec.byWeekday ?? []).map((d) => names[d]).join(", ");
  return `${every}${rec.interval > 1 ? `weeks on ${days}` : days}${at}`;
}
