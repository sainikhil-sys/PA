/**
 * Calendar math on YYYY-MM-DD strings (pure, unit-tested). "Today" always comes
 * from the user's timezone; everything after that is plain date arithmetic in UTC
 * so DST and the server's own timezone never shift a day.
 */

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** YYYY-MM-DD for `now` in the given IANA timezone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function toUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** True for a real calendar date (rejects 2026-02-30). */
export function isValidIsoDate(s: string): boolean {
  return ISO_DATE_RE.test(s) && toUtc(s).toISOString().slice(0, 10) === s;
}

export function addDays(iso: string, n: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(iso: string): number {
  return toUtc(iso).getUTCDay();
}

/** Monday of the week that contains `iso`. */
export function weekStart(iso: string): string {
  return addDays(iso, -((weekday(iso) + 6) % 7));
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** [first day, first day of next month) for a YYYY-MM month. */
export function monthRange(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${shiftMonth(month, 1)}-01` };
}

/** "October 2026" */
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(toUtc(`${month}-01`));
}

/** "Mon, Oct 20" */
export function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(toUtc(iso));
}

/** "Oct 20, 2026" */
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(toUtc(iso));
}

/**
 * Current streak: consecutive days with any logged time, ending today. A streak
 * that ended yesterday still counts (today isn't over yet). Dates after today are ignored.
 */
export function currentStreak(loggedDays: Iterable<string>, today: string): number {
  const days = new Set(loggedDays);
  let cursor = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** "45 min", "2 h", "3 h 20 min" */
export function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
