import { describe, expect, it } from "vitest";
import { bucketFocusDays } from "@/lib/focus/stats";
import { elapsedMs, idleTimer, isFinished, pauseTimer, remainingSeconds, restoreTimer, startTimer, toSession } from "@/lib/focus/timer";

const T0 = Date.parse("2026-10-14T04:30:00Z");
const MIN = 60_000;

describe("focus timer", () => {
  it("excludes paused time", () => {
    let s = startTimer(idleTimer(25), T0);
    s = pauseTimer(s, T0 + 10 * MIN);
    s = startTimer(s, T0 + 20 * MIN);
    expect(elapsedMs(s, T0 + 25 * MIN)).toBe(15 * MIN);
    expect(s.startedAt).toBe(T0);
  });
  it("clamps remaining time at zero and finishes at the planned length", () => {
    const s = startTimer(idleTimer(25), T0);
    expect(remainingSeconds(s, T0)).toBe(25 * 60);
    expect(isFinished(s, T0 + 24 * MIN)).toBe(false);
    expect(isFinished(s, T0 + 25 * MIN)).toBe(true);
    expect(remainingSeconds(s, T0 + 40 * MIN)).toBe(0);
  });
  it("builds a session to save", () => {
    const s = startTimer(idleTimer(25, "11111111-1111-1111-1111-111111111111"), T0);
    expect(toSession(s, T0 + 30_000, false)).toBeNull();
    expect(toSession(idleTimer(25), T0, false)).toBeNull();
    const done = toSession(s, T0 + 40 * MIN, true)!;
    expect(done.actualMinutes).toBe(25);
    expect(done.completed).toBe(true);
    expect(done.taskId).toBe("11111111-1111-1111-1111-111111111111");
    expect(done.startedAt).toBe("2026-10-14T04:30:00.000Z");
    expect(toSession(s, T0 + 7 * MIN, false)!.actualMinutes).toBe(7);
  });
  it("restores only valid, recent state for the same length", () => {
    const s = startTimer(idleTimer(25), T0);
    expect(restoreTimer(null, 25, T0)).toBeNull();
    expect(restoreTimer("garbage", 25, T0)).toBeNull();
    expect(restoreTimer({ ...s, accumulatedMs: "x" }, 25, T0)).toBeNull();
    expect(restoreTimer(s, 45, T0 + MIN)).toBeNull();
    expect(restoreTimer(s, 25, T0 + 13 * 3_600_000)).toBeNull();
    expect(restoreTimer(JSON.parse(JSON.stringify(s)), 25, T0 + MIN)).toEqual(s);
  });
});

describe("bucketFocusDays", () => {
  const TZ = "Asia/Kolkata";
  const now = new Date("2026-10-14T10:00:00Z"); // Wed 15:30 IST
  it("returns 7 zero-filled days, oldest first, today last", () => {
    const days = bucketFocusDays([], TZ, now);
    expect(days).toHaveLength(7);
    expect(days[0]!.date).toBe("2026-10-08");
    expect(days.at(-1)!.date).toBe("2026-10-14");
    expect(days.at(-1)!.label).toBe("Wed");
    expect(days.every((d) => d.minutes === 0 && d.sessions === 0)).toBe(true);
  });
  it("buckets by local day and sums", () => {
    const days = bucketFocusDays(
      [
        { startedAt: "2026-10-13T19:00:00Z", actualMinutes: 25 }, // 00:30 IST on the 14th
        { startedAt: new Date("2026-10-14T05:00:00Z"), actualMinutes: 50 },
        { startedAt: "2026-10-13T10:00:00Z", actualMinutes: 15 },
        { startedAt: "2026-09-01T10:00:00Z", actualMinutes: 99 },
      ],
      TZ,
      now,
    );
    expect(days.at(-1)).toMatchObject({ minutes: 75, sessions: 2 });
    expect(days.at(-2)).toMatchObject({ date: "2026-10-13", minutes: 15, sessions: 1 });
    expect(days.reduce((a, d) => a + d.minutes, 0)).toBe(90);
  });
});
