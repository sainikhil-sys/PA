import { CronExpressionParser } from "cron-parser";

/**
 * Natural-language schedules → cron (pure, unit tested).
 * Supports: "every day at 8am", "every weekday at 9:30", "every monday 9am",
 * "every hour", "every 15 minutes", "every month on the 1st at 10", or a raw cron.
 */
const DAYS: Record<string, number> = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };

function time(text: string): { h: number; m: number } {
  const t = /(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text.replace(/every\s+\d+\s+min\w*/i, ""));
  if (!t) return { h: 9, m: 0 };
  let h = Number(t[1]);
  const m = Number(t[2] ?? 0);
  if (t[3]?.toLowerCase() === "pm" && h < 12) h += 12;
  if (t[3]?.toLowerCase() === "am" && h === 12) h = 0;
  return { h: Math.min(h, 23), m: Math.min(m, 59) };
}

export function isValidCron(expr: string): boolean {
  try {
    CronExpressionParser.parse(expr);
    return expr.trim().split(/\s+/).length === 5;
  } catch {
    return false;
  }
}

export function scheduleToCron(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (isValidCron(s)) return s;
  let m = /every\s+(\d{1,2})\s+min/.exec(s);
  if (m) {
    const n = Math.max(5, Number(m[1])); // Vercel Cron granularity: keep >= 5 min
    return `*/${n} * * * *`;
  }
  if (/every\s+hour|hourly/.test(s)) return "0 * * * *";
  const { h, m: min } = time(s);
  if (/every\s+weekday|weekdays/.test(s)) return `${min} ${h} * * 1-5`;
  if (/every\s+weekend/.test(s)) return `${min} ${h} * * 0,6`;
  m = /every\s+month(?:\s+on\s+the)?\s+(\d{1,2})/.exec(s);
  if (m) return `${min} ${h} ${Math.min(28, Number(m[1]))} * *`;
  if (/every\s+month|monthly/.test(s)) return `${min} ${h} 1 * *`;
  const days = Object.keys(DAYS).filter((d) => new RegExp(`\\b${d}s?\\b`).test(s));
  if (days.length) return `${min} ${h} * * ${[...new Set(days.map((d) => DAYS[d]))].sort().join(",")}`;
  if (/every\s+day|daily|each\s+day|every\s+morning|every\s+evening/.test(s)) return `${min} ${h} * * *`;
  return null;
}

/** Next run strictly after `after`, evaluated in the owner's timezone. */
export function nextCronRun(expr: string, timezone: string, after: Date = new Date()): Date | null {
  try {
    return CronExpressionParser.parse(expr, { currentDate: after, tz: timezone }).next().toDate();
  } catch {
    return null;
  }
}

export function describeCron(expr: string): string {
  const [min, hour, dom, , dow] = expr.split(/\s+/);
  const at = hour !== "*" && min !== undefined && !min.startsWith("*") ? ` at ${hour!.padStart(2, "0")}:${min.padStart(2, "0")}` : "";
  if (min?.startsWith("*/")) return `Every ${min.slice(2)} minutes`;
  if (hour === "*" && min === "0") return "Every hour";
  if (dow === "1-5") return `Every weekday${at}`;
  if (dow && dow !== "*") {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `Every ${dow.split(",").map((d) => names[Number(d)] ?? d).join(", ")}${at}`;
  }
  if (dom && dom !== "*") return `Monthly on day ${dom}${at}`;
  return `Every day${at}`;
}
