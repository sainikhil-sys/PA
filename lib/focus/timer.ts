/**
 * Focus timer state, measured from timestamps instead of counting ticks, so a
 * throttled background tab still ends on time. Pure and unit tested.
 */

export type TimerState = {
  plannedMinutes: number;
  /** First start (ms since epoch); null while idle. */
  startedAt: number | null;
  /** When the current run began; null while paused or idle. */
  runningSince: number | null;
  /** Time already run before the current run (pauses excluded). */
  accumulatedMs: number;
  taskId: string | null;
};

export type FocusSessionInput = { startedAt: string; plannedMinutes: number; actualMinutes: number; taskId: string | null; completed: boolean };

export const FOCUS_STORAGE_KEY = "cowork.focus.v1";
const MAX_AGE_MS = 12 * 3_600_000;

export function idleTimer(plannedMinutes: number, taskId: string | null = null): TimerState {
  return { plannedMinutes, startedAt: null, runningSince: null, accumulatedMs: 0, taskId };
}

export function startTimer(s: TimerState, now: number): TimerState {
  if (s.runningSince !== null) return s;
  return { ...s, startedAt: s.startedAt ?? now, runningSince: now };
}

export function pauseTimer(s: TimerState, now: number): TimerState {
  if (s.runningSince === null) return s;
  return { ...s, accumulatedMs: s.accumulatedMs + Math.max(0, now - s.runningSince), runningSince: null };
}

export function elapsedMs(s: TimerState, now: number): number {
  return s.accumulatedMs + (s.runningSince !== null ? Math.max(0, now - s.runningSince) : 0);
}

export function remainingSeconds(s: TimerState, now: number): number {
  return Math.max(0, Math.ceil((s.plannedMinutes * 60_000 - elapsedMs(s, now)) / 1000));
}

export function isFinished(s: TimerState, now: number): boolean {
  return s.startedAt !== null && elapsedMs(s, now) >= s.plannedMinutes * 60_000;
}

/** The session to save, or null when it ran for less than a minute. */
export function toSession(s: TimerState, now: number, completed: boolean): FocusSessionInput | null {
  if (s.startedAt === null) return null;
  const elapsed = elapsedMs(s, now);
  if (elapsed < 60_000) return null;
  const actualMinutes = Math.max(1, Math.round(Math.min(elapsed, s.plannedMinutes * 60_000) / 60_000));
  return { startedAt: new Date(s.startedAt).toISOString(), plannedMinutes: s.plannedMinutes, actualMinutes, taskId: s.taskId, completed };
}

/** Rebuild a timer saved in localStorage. Drops anything malformed, stale or for another length. */
export function restoreTimer(raw: unknown, plannedMinutes: number, now: number): TimerState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (r.plannedMinutes !== plannedMinutes) return null;
  if (!num(r.startedAt) || !num(r.accumulatedMs) || (r.accumulatedMs as number) < 0) return null;
  if (r.runningSince !== null && !num(r.runningSince)) return null;
  if (r.taskId !== null && typeof r.taskId !== "string") return null;
  const startedAt = r.startedAt as number;
  if (startedAt > now + 60_000 || now - startedAt > MAX_AGE_MS) return null;
  return {
    plannedMinutes,
    startedAt,
    runningSince: (r.runningSince as number | null) ?? null,
    accumulatedMs: r.accumulatedMs as number,
    taskId: (r.taskId as string | null) ?? null,
  };
}
