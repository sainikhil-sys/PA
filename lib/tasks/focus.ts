/**
 * Suggest focus-time blocks: free gaps of at least `minMinutes` inside working
 * hours, avoiding busy intervals. Pure and unit tested. Suggestions are shown
 * only; nothing is created unless the owner clicks.
 */
export type Interval = { start: Date; end: Date };

export function suggestFocusBlocks(
  busy: Interval[],
  day: { workStart: Date; workEnd: Date },
  opts: { minMinutes?: number; maxBlocks?: number; now?: Date } = {},
): Interval[] {
  const min = (opts.minMinutes ?? 90) * 60_000;
  const start = new Date(Math.max(day.workStart.getTime(), opts.now?.getTime() ?? 0));
  const sorted = busy
    .filter((b) => b.end > start && b.start < day.workEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  let cursor = start;
  for (const b of sorted) {
    if (b.start.getTime() - cursor.getTime() >= min) out.push({ start: cursor, end: b.start });
    if (b.end > cursor) cursor = b.end;
  }
  if (day.workEnd.getTime() - cursor.getTime() >= min) out.push({ start: cursor, end: day.workEnd });
  // Cap each suggestion at 2h so it stays a realistic focus block.
  return out.slice(0, opts.maxBlocks ?? 2).map((g) => ({ start: g.start, end: new Date(Math.min(g.end.getTime(), g.start.getTime() + 120 * 60_000)) }));
}
