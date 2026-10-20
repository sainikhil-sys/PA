/** Date and time formatting for Home, Approvals and Notifications, always in the user's timezone. */

function fmt(opts: Intl.DateTimeFormatOptions, tz?: string | null): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(undefined, tz ? { ...opts, timeZone: tz } : opts);
  } catch {
    // An unknown timezone string falls back to the device's own zone.
    return new Intl.DateTimeFormat(undefined, opts);
  }
}

/** A calendar day ("2026-10-20") as "Tuesday, October 20". The day is already local, so format it at noon UTC. */
export function longDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return fmt({ weekday: "long", month: "long", day: "numeric" }, "UTC").format(d);
}

/** A calendar day as "Oct 19". */
export function shortDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return fmt({ month: "short", day: "numeric" }, "UTC").format(d);
}

/** Hour of day (0 to 23) right now in the given timezone. */
export function hourIn(tz?: string | null): number {
  const h = Number(fmt({ hour: "numeric", hourCycle: "h23" }, tz).format(new Date()));
  return Number.isFinite(h) ? h % 24 : new Date().getHours();
}

export function greeting(tz?: string | null): string {
  const h = hourIn(tz);
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** "9:30 AM" in the user's timezone. Date-only values (all-day events) return null. */
export function clock(iso: string, tz?: string | null): string | null {
  if (!iso || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return fmt({ hour: "numeric", minute: "2-digit" }, tz).format(d);
}

/** "Just now", "5m ago", "3h ago", "Yesterday", then "Oct 3". */
export function relativeTime(iso: string, tz?: string | null): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  if (h < 48) return "Yesterday";
  return fmt({ month: "short", day: "numeric" }, tz).format(d);
}

/** First word of a display name, or null. */
export function firstName(name: string | null | undefined): string | null {
  const n = name?.trim().split(/\s+/)[0];
  return n ? n : null;
}
