import { describe, expect, it } from "vitest";
import { formatMinutes, fromLocalInput, matchReminderPreset, reminderOffsetLabel, reminderPresets, shiftReminder, toLocalInput } from "@/lib/tasks/timing";

const TZ = "Asia/Kolkata";
// Wednesday 2026-10-14 10:00 IST
const NOW = new Date("2026-10-14T04:30:00Z");
const START = new Date("2026-10-15T11:30:00Z"); // 17:00 IST

describe("formatMinutes", () => {
  it("formats minutes and hours", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(90)).toBe("1h 30m");
  });
});

describe("reminderPresets", () => {
  it("offers offsets before the start time", () => {
    const p = reminderPresets({ scheduledAt: START, dueDate: null, timezone: TZ, now: NOW });
    const byId = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(byId["before-0"]!.at.toISOString()).toBe("2026-10-15T11:30:00.000Z");
    expect(byId["before-0"]!.label).toBe("At start time");
    expect(byId["before-15"]!.at.toISOString()).toBe("2026-10-15T11:15:00.000Z");
    expect(byId["before-60"]!.label).toBe("1 hour before");
    expect(byId["before-1440"]!.at.toISOString()).toBe("2026-10-14T11:30:00.000Z");
    expect(byId["before-1440"]!.relative).toBe(true);
    expect(byId["tomorrow-9"]!.at.toISOString()).toBe("2026-10-15T03:30:00.000Z");
    expect(byId["in-1h"]!.at.toISOString()).toBe("2026-10-14T05:30:00.000Z");
    expect(byId["in-1h"]!.relative).toBe(false);
  });
  it("drops presets already in the past", () => {
    const p = reminderPresets({ scheduledAt: START, dueDate: null, timezone: TZ, now: new Date(START.getTime() - 40 * 60_000) });
    const ids = p.map((x) => x.id);
    expect(ids).not.toContain("before-60");
    expect(ids).not.toContain("before-1440");
    expect(ids).toContain("before-30");
    expect(ids).toContain("before-0");
  });
  it("offers due-date presets when there is no start time", () => {
    const p = reminderPresets({ scheduledAt: null, dueDate: "2026-10-16", timezone: TZ, now: NOW });
    const byId = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(byId["due-morning"]!.at.toISOString()).toBe("2026-10-16T03:30:00.000Z");
    expect(byId["due-eve"]!.at.toISOString()).toBe("2026-10-15T03:30:00.000Z");
    expect(p.some((x) => x.id.startsWith("before-"))).toBe(false);
  });
  it("offers this evening only before 17:00 local", () => {
    expect(reminderPresets({ scheduledAt: null, dueDate: null, timezone: TZ, now: NOW }).map((x) => x.id)).toContain("evening");
    const late = new Date("2026-10-14T12:00:00Z"); // 17:30 IST
    expect(reminderPresets({ scheduledAt: null, dueDate: null, timezone: TZ, now: late }).map((x) => x.id)).not.toContain("evening");
  });
});

describe("matchReminderPreset and reminderOffsetLabel", () => {
  const presets = reminderPresets({ scheduledAt: START, dueDate: null, timezone: TZ, now: NOW });
  it("matches a relative preset within a minute", () => {
    expect(matchReminderPreset(new Date("2026-10-15T11:15:30Z"), presets)).toBe("before-15");
    expect(matchReminderPreset(new Date("2026-10-15T11:07:00Z"), presets)).toBe("custom");
    expect(matchReminderPreset(null, presets)).toBe("none");
  });
  it("labels standard offsets only", () => {
    expect(reminderOffsetLabel("2026-10-15T11:15:00Z", START)).toBe("15m before");
    expect(reminderOffsetLabel(START, START)).toBe("At start");
    expect(reminderOffsetLabel("2026-10-15T11:07:00Z", START)).toBeNull();
    expect(reminderOffsetLabel("2026-10-15T11:07:00Z", null)).toBeNull();
  });
});

describe("shiftReminder", () => {
  const next = new Date("2026-10-16T05:00:00Z");
  it("keeps the offset on reschedule", () => {
    expect(shiftReminder({ scheduledAt: START, remindAt: new Date(START.getTime() - 15 * 60_000) }, next)?.toISOString()).toBe("2026-10-16T04:45:00.000Z");
  });
  it("keeps a reminder that was off, off", () => {
    expect(shiftReminder({ scheduledAt: START, remindAt: null }, next)).toBeNull();
  });
  it("reminds at the start for a first schedule with no reminder", () => {
    expect(shiftReminder({ scheduledAt: null, remindAt: null }, next)).toBe(next);
  });
  it("leaves an absolute reminder on an unscheduled task alone", () => {
    expect(shiftReminder({ scheduledAt: null, remindAt: NOW }, next)).toBeUndefined();
  });
  it("drops a start-relative reminder when the start is cleared", () => {
    expect(shiftReminder({ scheduledAt: START, remindAt: START }, null)).toBeNull();
  });
});

describe("datetime-local conversion", () => {
  it("round-trips in the owner's timezone", () => {
    expect(fromLocalInput("2026-10-20T09:00", TZ).toISOString()).toBe("2026-10-20T03:30:00.000Z");
    expect(toLocalInput("2026-10-20T03:30:00Z", TZ)).toBe("2026-10-20T09:00");
    expect(toLocalInput(null, TZ)).toBe("");
  });
});
