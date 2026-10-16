import { describe, expect, it } from "vitest";
import { suggestFocusBlocks } from "@/lib/tasks/focus";
import { describeRecurrence, nextOccurrence, parseQuickAdd } from "@/lib/tasks/quick-add";
import { canClaim, canComplete, canMove } from "@/lib/tasks/transitions";

const TZ = "Asia/Kolkata";
// Wednesday 2026-10-14 10:00 IST
const NOW = new Date("2026-10-14T04:30:00Z");

describe("task state machine", () => {
  it("lets Claude claim only To do tasks and never mark Done", () => {
    expect(canClaim({ status: "todo", assignee: "me" }, "claude").ok).toBe(true);
    expect(canClaim({ status: "needs_review", assignee: "claude" }, "claude").ok).toBe(false);
    expect(canClaim({ status: "todo", assignee: "agent" }, "claude").ok).toBe(false);
    expect(canComplete({ status: "todo", assignee: "claude" }, "claude").ok).toBe(false);
    expect(canComplete({ status: "in_progress", assignee: "claude" }, "claude").ok).toBe(true);
    expect(canMove("needs_review", "done", "claude").ok).toBe(false);
    expect(canMove("needs_review", "done", "me").ok).toBe(true);
  });
});

describe("natural-language quick add", () => {
  it("schedules 'tomorrow at 5' as 5pm local", () => {
    const r = parseQuickAdd("call Ravi tomorrow at 5", TZ, NOW);
    expect(r.title).toBe("call Ravi");
    expect(r.scheduledAt?.toISOString()).toBe("2026-10-15T11:30:00.000Z"); // 17:00 IST
  });
  it("parses weekly recurrence", () => {
    const r = parseQuickAdd("every Monday 9am review inbox", TZ, NOW);
    expect(r.title).toBe("review inbox");
    expect(r.recurrence).toMatchObject({ freq: "weekly", byWeekday: [1], time: "09:00" });
    expect(r.scheduledAt?.toISOString()).toBe("2026-10-19T03:30:00.000Z"); // next Monday 09:00 IST
    expect(describeRecurrence(r.recurrence!)).toBe("Every Mon at 09:00");
  });
  it("treats 'by Friday' as a due date and reads tags and priority", () => {
    const r = parseQuickAdd("send invoice by Friday #finance !high", TZ, NOW);
    expect(r.title).toBe("send invoice");
    expect(r.dueDate).toBe("2026-10-16");
    expect(r.tags).toEqual(["finance"]);
    expect(r.priority).toBe(3);
  });
  it("keeps plain titles untouched", () => {
    expect(parseQuickAdd("buy milk", TZ, NOW)).toMatchObject({ title: "buy milk", dueDate: null, scheduledAt: null, recurrence: null });
  });
  it("finds the next daily occurrence after now", () => {
    expect(nextOccurrence({ freq: "daily", interval: 1, time: "08:00" }, TZ, NOW).toISOString()).toBe("2026-10-15T02:30:00.000Z");
  });
});

describe("focus-time suggestions", () => {
  const d = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 14, h, m));
  it("finds gaps of at least 90 minutes inside working hours", () => {
    const blocks = suggestFocusBlocks([{ start: d(10), end: d(11) }, { start: d(13), end: d(14) }], { workStart: d(9), workEnd: d(18) });
    expect(blocks).toEqual([
      { start: d(11), end: d(13) },
      { start: d(14), end: d(16) },
    ]);
  });
  it("returns nothing on a packed day", () => {
    expect(suggestFocusBlocks([{ start: d(9), end: d(18) }], { workStart: d(9), workEnd: d(18) })).toEqual([]);
  });
});
