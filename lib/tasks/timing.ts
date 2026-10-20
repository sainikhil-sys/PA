import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { localDayBounds, localDate } from "@/lib/time";

/**
 * Task timing helpers: duration labels, reminder presets and how a reminder
 * follows a reschedule. Pure and client-safe (the drawer and the queries share it).
 */

export const DURATION_PRESETS = [15, 30, 45, 60, 90, 120, 180, 240] as const;

/** 45 → "45m", 60 → "1h", 90 → "1h 30m". */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Minutes before the start time that the relative reminder presets use. */
export const REMIND_OFFSETS = [0, 5, 15, 30, 60, 1440] as const;

const OFFSET_LABEL: Record<(typeof REMIND_OFFSETS)[number], { preset: string; mark: string }> = {
  0: { preset: "At start time", mark: "At start" },
  5: { preset: "5 min before", mark: "5m before" },
  15: { preset: "15 min before", mark: "15m before" },
  30: { preset: "30 min before", mark: "30m before" },
  60: { preset: "1 hour before", mark: "1h before" },
  1440: { preset: "1 day before", mark: "1d before" },
};

export type ReminderPreset = { id: string; label: string; at: Date; relative: boolean };

const MIN = 60_000;
const toDate = (d: Date | string) => (typeof d === "string" ? new Date(d) : d);

export function reminderPresets({
  scheduledAt,
  dueDate,
  timezone,
  now = new Date(),
}: {
  scheduledAt: Date | string | null;
  dueDate: string | null;
  timezone: string;
  now?: Date;
}): ReminderPreset[] {
  const out: ReminderPreset[] = [];
  if (scheduledAt) {
    const start = toDate(scheduledAt).getTime();
    for (const off of REMIND_OFFSETS) out.push({ id: `before-${off}`, label: OFFSET_LABEL[off].preset, at: new Date(start - off * MIN), relative: true });
  } else if (dueDate) {
    const morning = fromZonedTime(`${dueDate}T09:00:00`, timezone);
    const dayBefore = localDayBounds(timezone, -1, fromZonedTime(`${dueDate}T12:00:00`, timezone)).date;
    out.push({ id: "due-morning", label: "Morning of due date (09:00)", at: morning, relative: true });
    out.push({ id: "due-eve", label: "Day before (09:00)", at: fromZonedTime(`${dayBefore}T09:00:00`, timezone), relative: true });
  }
  // Quick absolute times.
  const five = 5 * MIN;
  out.push({ id: "in-1h", label: "In 1 hour", at: new Date(Math.ceil((now.getTime() + 60 * MIN) / five) * five), relative: false });
  if (formatInTimeZone(now, timezone, "HH:mm") < "17:00") {
    out.push({ id: "evening", label: "This evening (18:00)", at: fromZonedTime(`${localDate(timezone, now)}T18:00:00`, timezone), relative: false });
  }
  const tomorrow = localDayBounds(timezone, 1, now).date;
  out.push({ id: "tomorrow-9", label: "Tomorrow at 09:00", at: fromZonedTime(`${tomorrow}T09:00:00`, timezone), relative: false });
  return out.filter((p) => p.at.getTime() > now.getTime());
}

/** Which select option a stored reminder corresponds to. */
export function matchReminderPreset(remindAt: Date | string | null, presets: ReminderPreset[]): string {
  if (!remindAt) return "none";
  const t = toDate(remindAt).getTime();
  const hit = presets.find((p) => p.relative && Math.abs(p.at.getTime() - t) <= MIN);
  return hit ? hit.id : "custom";
}

/** "15m before" when the reminder sits at a standard offset from the start, else null. */
export function reminderOffsetLabel(remindAt: Date | string | null, scheduledAt: Date | string | null): string | null {
  if (!remindAt || !scheduledAt) return null;
  const diff = toDate(scheduledAt).getTime() - toDate(remindAt).getTime();
  const off = REMIND_OFFSETS.find((o) => Math.abs(diff - o * MIN) <= MIN);
  return off === undefined ? null : OFFSET_LABEL[off].mark;
}

/**
 * Where a reminder goes when a task's start time changes.
 * Returns undefined when the reminder should be left untouched.
 */
export function shiftReminder(prev: { scheduledAt: Date | null; remindAt: Date | null }, next: Date | null): Date | null | undefined {
  // Clearing the start time drops a start-relative reminder; an absolute one on an unscheduled task stays.
  if (next === null) return prev.scheduledAt ? null : undefined;
  if (prev.scheduledAt && prev.remindAt) return new Date(next.getTime() - (prev.scheduledAt.getTime() - prev.remindAt.getTime()));
  // The owner turned the reminder off: keep it off.
  if (prev.scheduledAt) return null;
  // An absolute reminder on an unscheduled task stays where it is.
  if (prev.remindAt) return undefined;
  // First time scheduled: remind at the start, as createTask does.
  return next;
}

/** Value for <input type="datetime-local"> in the owner's timezone (not the browser's). */
export function toLocalInput(d: Date | string | null, tz: string): string {
  if (!d) return "";
  return formatInTimeZone(toDate(d), tz, "yyyy-MM-dd'T'HH:mm");
}

export function fromLocalInput(value: string, tz: string): Date {
  return fromZonedTime(`${value}:00`, tz);
}
