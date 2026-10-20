import type { Metadata } from "next";
import { MoneyView } from "@/components/trackers/money-view";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/queries/settings";
import { monthOf, MONTH_RE, todayIn } from "@/lib/trackers/dates";
import { listBudgets, listMonthExpenses, monthCategoryTotals } from "@/lib/trackers/queries";

export const metadata: Metadata = { title: "Money" };
export const dynamic = "force-dynamic";

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireOwner();
  const [{ timezone }, sp] = await Promise.all([getSettings(user.id), searchParams]);
  const today = todayIn(timezone);
  const current = monthOf(today);
  // Unknown or future months fall back to this month.
  const month = sp.month && MONTH_RE.test(sp.month) && sp.month <= current ? sp.month : current;
  const [expenses, categories, budgets] = await Promise.all([listMonthExpenses(user.id, month), monthCategoryTotals(user.id, month), listBudgets(user.id)]);
  return <MoneyView month={month} currentMonth={current} today={today} expenses={expenses} categories={categories} budgets={budgets} />;
}
