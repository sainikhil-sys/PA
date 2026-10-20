import "server-only";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { monthRange } from "./dates";

/** Every query here is scoped by userId. Ids from the client are only ever used together with it. */

const e = schema.expenses;
const b = schema.expenseBudgets;
const li = schema.learningItems;
const ll = schema.learningLogs;

export class TrackerError extends Error {}

// ---------- Money ----------

export async function listMonthExpenses(userId: string, month: string) {
  const { start, end } = monthRange(month);
  return db()
    .select({ id: e.id, amountMinor: e.amountMinor, currency: e.currency, category: e.category, merchant: e.merchant, note: e.note, spentOn: e.spentOn })
    .from(e)
    .where(and(eq(e.userId, userId), gte(e.spentOn, start), lt(e.spentOn, end)))
    .orderBy(desc(e.spentOn), desc(e.createdAt))
    .limit(2000);
}

/** Per currency and category sums for a month, summed in SQL (bigint sums come back as strings). */
export async function monthCategoryTotals(userId: string, month: string) {
  const { start, end } = monthRange(month);
  const rows = await db()
    .select({ currency: e.currency, category: e.category, total: sql<string>`coalesce(sum(${e.amountMinor}), 0)`, count: sql<number>`count(*)::int` })
    .from(e)
    .where(and(eq(e.userId, userId), gte(e.spentOn, start), lt(e.spentOn, end)))
    .groupBy(e.currency, e.category);
  return rows.map((r) => ({ currency: r.currency, category: r.category, minor: Number(r.total), count: Number(r.count) }));
}

export async function listBudgets(userId: string) {
  return db().select({ category: b.category, currency: b.currency, monthlyMinor: b.monthlyMinor }).from(b).where(eq(b.userId, userId)).orderBy(asc(b.category));
}

export type ExpenseInput = { amountMinor: number; currency: string; category: string; merchant: string; note: string; spentOn: string };

export async function createExpense(userId: string, input: ExpenseInput) {
  const [row] = await db().insert(e).values({ userId, ...input }).returning({ id: e.id });
  return row!;
}

export async function updateExpense(userId: string, id: string, input: ExpenseInput) {
  const rows = await db()
    .update(e)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(e.id, id), eq(e.userId, userId)))
    .returning({ id: e.id });
  if (!rows.length) throw new TrackerError("That expense no longer exists.");
}

export async function deleteExpense(userId: string, id: string) {
  await db().delete(e).where(and(eq(e.id, id), eq(e.userId, userId)));
}

export async function setBudget(userId: string, category: string, currency: string, monthlyMinor: number | null) {
  if (monthlyMinor === null) {
    await db().delete(b).where(and(eq(b.userId, userId), eq(b.category, category), eq(b.currency, currency)));
    return;
  }
  await db()
    .insert(b)
    .values({ userId, category, currency, monthlyMinor })
    .onConflictDoUpdate({ target: [b.userId, b.category, b.currency], set: { monthlyMinor, updatedAt: new Date() } });
}

// ---------- Learning ----------

export async function listLearningItems(userId: string) {
  return db()
    .select({ id: li.id, title: li.title, kind: li.kind, status: li.status, progress: li.progress, url: li.url, notes: li.notes, targetDate: li.targetDate, completedAt: li.completedAt, updatedAt: li.updatedAt })
    .from(li)
    .where(eq(li.userId, userId))
    .orderBy(desc(li.updatedAt))
    .limit(500);
}

/** Total minutes per item, all time. */
export async function minutesByItem(userId: string): Promise<Map<string, number>> {
  const rows = await db()
    .select({ itemId: ll.itemId, total: sql<string>`coalesce(sum(${ll.minutes}), 0)` })
    .from(ll)
    .where(eq(ll.userId, userId))
    .groupBy(ll.itemId);
  return new Map(rows.map((r) => [r.itemId, Number(r.total)]));
}

/** Minutes logged on or after `since` (a YYYY-MM-DD). */
export async function minutesSince(userId: string, since: string): Promise<number> {
  const [row] = await db()
    .select({ total: sql<string>`coalesce(sum(${ll.minutes}), 0)` })
    .from(ll)
    .where(and(eq(ll.userId, userId), gte(ll.loggedOn, since)));
  return Number(row?.total ?? 0);
}

/** Distinct days with any logged time since `since`, for the streak. */
export async function loggedDaysSince(userId: string, since: string): Promise<string[]> {
  const rows = await db()
    .selectDistinct({ day: ll.loggedOn })
    .from(ll)
    .where(and(eq(ll.userId, userId), gte(ll.loggedOn, since)));
  return rows.map((r) => r.day);
}

export type LearningInput = { title: string; kind: string; url: string | null; notes: string; targetDate: string | null };

export async function createLearningItem(userId: string, input: LearningInput) {
  const [row] = await db().insert(li).values({ userId, ...input, status: "active" }).returning({ id: li.id });
  return row!;
}

export async function updateLearningItem(
  userId: string,
  id: string,
  patch: Partial<LearningInput> & { status?: string; progress?: number },
) {
  const set: Partial<typeof li.$inferInsert> = { ...patch, updatedAt: new Date() };
  // Marking done stamps completedAt and fills the bar; leaving done clears it.
  if (patch.status === "done") {
    set.completedAt = new Date();
    set.progress = 100;
  } else if (patch.status) {
    set.completedAt = null;
  }
  const rows = await db()
    .update(li)
    .set(set)
    .where(and(eq(li.id, id), eq(li.userId, userId)))
    .returning({ id: li.id });
  if (!rows.length) throw new TrackerError("That item no longer exists.");
}

export async function deleteLearningItem(userId: string, id: string) {
  await db().delete(li).where(and(eq(li.id, id), eq(li.userId, userId)));
}

export async function logLearningTime(userId: string, itemId: string, minutes: number, loggedOn: string, note: string) {
  // Ownership check before inserting: the item id came from the client.
  const touched = await db()
    .update(li)
    .set({ updatedAt: new Date() })
    .where(and(eq(li.id, itemId), eq(li.userId, userId)))
    .returning({ id: li.id });
  if (!touched.length) throw new TrackerError("That item no longer exists.");
  await db().insert(ll).values({ userId, itemId, minutes, loggedOn, note });
}
