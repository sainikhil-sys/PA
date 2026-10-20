import type { TaskSummary } from "@/lib/types";

/** Priority 0..3 as the server stores it (same labels as the web). */
export const PRIORITY_LABEL = ["None", "Low", "Medium", "High"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date's calendar day on this device, as YYYY-MM-DD. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD read as local midnight (not UTC, which would shift the day west of Greenwich). */
export function fromYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** The day a task belongs to: the earlier of its due date and its scheduled day, or null. */
export function taskDay(t: Pick<TaskSummary, "dueDate" | "scheduledAt">): string | null {
  const days = [t.dueDate, t.scheduledAt ? ymd(new Date(t.scheduledAt)) : null].filter((v): v is string => Boolean(v));
  if (!days.length) return null;
  return days.sort()[0];
}

function addDays(day: string, n: number): string {
  const d = fromYmd(day);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** "Today", "Tomorrow", "Yesterday" or a short date like "Tue, Oct 21". */
export function dayLabel(day: string, today = ymd(new Date())): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  const d = fromYmd(day);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Today, 6:00 PM" for a scheduled task, "Due Tomorrow" for a dated one, null otherwise. */
export function whenLabel(t: Pick<TaskSummary, "dueDate" | "scheduledAt">): string | null {
  if (t.scheduledAt) return `${dayLabel(ymd(new Date(t.scheduledAt)))}, ${timeLabel(t.scheduledAt)}`;
  if (t.dueDate) return `Due ${dayLabel(t.dueDate)}`;
  return null;
}

export type TaskGroup = { key: "overdue" | "today" | "upcoming" | "none"; title: string; data: TaskSummary[] };

/** Overdue, Today, Upcoming, No date, by the device's local calendar. Empty groups are dropped. */
export function groupTasks(items: TaskSummary[], today = ymd(new Date())): TaskGroup[] {
  const groups: TaskGroup[] = [
    { key: "overdue", title: "Overdue", data: [] },
    { key: "today", title: "Today", data: [] },
    { key: "upcoming", title: "Upcoming", data: [] },
    { key: "none", title: "No date", data: [] },
  ];
  const at = (t: TaskSummary) => (t.scheduledAt ? new Date(t.scheduledAt).getTime() : Number.MAX_SAFE_INTEGER);
  const sorted = [...items].sort((a, b) => {
    const da = taskDay(a) ?? "9999";
    const db = taskDay(b) ?? "9999";
    if (da !== db) return da < db ? -1 : 1;
    if (at(a) !== at(b)) return at(a) - at(b);
    return b.priority - a.priority;
  });
  for (const t of sorted) {
    const day = taskDay(t);
    const g = !day ? groups[3] : day < today ? groups[0] : day === today ? groups[1] : groups[2];
    g.data.push(t);
  }
  return groups.filter((g) => g.data.length > 0);
}
