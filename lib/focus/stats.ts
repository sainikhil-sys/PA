import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { localDate, localDayBounds } from "@/lib/time";

export type FocusDay = { date: string; label: string; minutes: number; sessions: number };

/** Focus minutes per local day, oldest first, zero-filled; the last entry is today. */
export function bucketFocusDays(sessions: { startedAt: Date | string; actualMinutes: number }[], timezone: string, now = new Date(), days = 7): FocusDay[] {
  const out: FocusDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = localDayBounds(timezone, -i, now).date;
    out.push({ date, label: formatInTimeZone(fromZonedTime(`${date}T12:00:00`, timezone), timezone, "EEE"), minutes: 0, sessions: 0 });
  }
  const byDate = new Map(out.map((d) => [d.date, d]));
  for (const s of sessions) {
    const day = byDate.get(localDate(timezone, typeof s.startedAt === "string" ? new Date(s.startedAt) : s.startedAt));
    if (!day) continue;
    day.minutes += s.actualMinutes;
    day.sessions += 1;
  }
  return out;
}
