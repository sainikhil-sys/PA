import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** Cron runs in UTC; all user-facing dates are computed in the user's timezone. */

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** YYYY-MM-DD in the given timezone. */
export function localDate(tz: string, at: Date = new Date()): string {
  return formatInTimeZone(at, tz, "yyyy-MM-dd");
}

/** HH:mm in the given timezone. */
export function localTime(tz: string, at: Date = new Date()): string {
  return formatInTimeZone(at, tz, "HH:mm");
}

/** UTC instants for the start and end of a local day (offsetDays from today). */
export function localDayBounds(tz: string, offsetDays = 0, at: Date = new Date()): { start: Date; end: Date; date: string } {
  const today = localDate(tz, at);
  const base = fromZonedTime(`${today}T00:00:00`, tz);
  // Recompute via the local date string to stay correct across DST transitions.
  const date = localDate(tz, addDays(base, offsetDays));
  const start = fromZonedTime(`${date}T00:00:00`, tz);
  const next = localDate(tz, addDays(start, 1.5));
  const end = fromZonedTime(`${next}T00:00:00`, tz);
  return { start, end, date };
}

/** True once the local clock has reached HH:MM. */
export function isPastLocalTime(tz: string, hhmm: string, at: Date = new Date()): boolean {
  return localTime(tz, at) >= hhmm;
}

export function formatTime(iso: string, tz: string): string {
  return formatInTimeZone(new Date(iso), tz, "HH:mm");
}

export function formatDateTime(d: Date | string, tz: string): string {
  return formatInTimeZone(typeof d === "string" ? new Date(d) : d, tz, "MMM d, HH:mm");
}

/** True if HH:MM `now` falls inside [start, end), handling overnight windows like 22:00–07:00. */
export function inQuietHours(now: string, start: string | null, end: string | null): boolean {
  if (!start || !end || start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
