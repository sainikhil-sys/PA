"use client";

import { CaretLeft, CaretRight, DownloadSimple, PencilSimple, Plus, Receipt } from "@phosphor-icons/react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { quickAddExpenseAction } from "@/app/actions/trackers";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/states";
import { dayLabel, monthLabel, shiftMonth } from "@/lib/trackers/dates";
import { categoryLabel, formatMoney } from "@/lib/trackers/money";
import { cn } from "@/lib/utils";
import { ExpenseDialog, type ExpenseRow } from "./expense-dialog";
import { CurrencySelect, useShowAll, useStoredCurrency } from "./fields";
import { type Budget, BudgetsCard, CategoriesCard, type CategoryTotal, TotalsCard } from "./money-summary";

export function MoneyView({
  month,
  currentMonth,
  today,
  expenses,
  categories,
  budgets,
}: {
  month: string;
  currentMonth: string;
  today: string;
  expenses: ExpenseRow[];
  categories: CategoryTotal[];
  budgets: Budget[];
}) {
  const [currency, setCurrency] = useStoredCurrency();
  const [dialog, setDialog] = React.useState<{ expense: ExpenseRow | null } | null>(null);
  const name = monthLabel(month);

  const totals = React.useMemo(() => {
    const m = new Map<string, { minor: number; count: number }>();
    for (const c of categories) {
      const t = m.get(c.currency) ?? { minor: 0, count: 0 };
      m.set(c.currency, { minor: t.minor + c.minor, count: t.count + c.count });
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cur, t]) => ({ currency: cur, ...t }));
  }, [categories]);

  return (
    <div className="flex flex-col gap-4">
      <QuickAddExpense currency={currency} onCurrency={setCurrency} onDetails={() => setDialog({ expense: null })} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link href={`/trackers/money?month=${shiftMonth(month, -1)}`} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Previous month">
            <CaretLeft />
          </Link>
          <h2 className="min-w-36 text-center text-[15px] font-medium">{name}</h2>
          {month < currentMonth ? (
            <Link href={`/trackers/money?month=${shiftMonth(month, 1)}`} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Next month">
              <CaretRight />
            </Link>
          ) : (
            <span className="size-11" aria-hidden />
          )}
        </div>
        {expenses.length ? (
          <a href={`/api/trackers/expenses?month=${month}`} className={buttonVariants({ variant: "quiet", size: "md" })} download>
            <DownloadSimple /> CSV
          </a>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TotalsCard totals={totals} monthName={name} />
        <BudgetsCard budgets={budgets} categories={categories} monthName={name} defaultCurrency={currency} />
      </div>
      <CategoriesCard key={month} categories={categories} />

      <Card>
        {expenses.length ? (
          <ExpenseList key={month} expenses={expenses} onEdit={(e) => setDialog({ expense: e })} />
        ) : (
          <EmptyState
            icon={Receipt}
            title={`Nothing logged for ${name}.`}
            description={month === currentMonth ? "Type an amount above, like 120 coffee." : undefined}
            action={
              <Button size="sm" onClick={() => setDialog({ expense: null })}>
                Add an expense
              </Button>
            }
          />
        )}
      </Card>

      <ExpenseDialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)} expense={dialog?.expense ?? null} defaultCurrency={currency} today={today} />
    </div>
  );
}

function QuickAddExpense({ currency, onCurrency, onDetails }: { currency: string; onCurrency: (c: string) => void; onDetails: () => void }) {
  const [value, setValue] = React.useState("");
  const [pending, start] = React.useTransition();
  const submit = () =>
    start(async () => {
      if (!value.trim()) return;
      const res = await quickAddExpenseAction({ text: value, currency });
      if (!res.ok) return void toast.error(res.error);
      const d = res.data;
      toast.success(`Added ${formatMoney(d.amountMinor, d.currency)}`, { description: [categoryLabel(d.category), d.merchant, d.spentOn].filter(Boolean).join(", ") });
      setValue("");
    });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <label htmlFor="expense-quick-add" className="sr-only">
        Add an expense
      </label>
      <div className="relative flex-1">
        <Plus size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          id="expense-quick-add"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
          placeholder="120 coffee, or 450.50 groceries at DMart yesterday"
          className={cn(inputClass, "pl-10")}
          autoComplete="off"
          maxLength={200}
        />
      </div>
      <div className="flex gap-2">
        <CurrencySelect id="quick-currency" value={currency} onChange={onCurrency} className="w-24" />
        <Button variant="primary" type="submit" disabled={pending || !value.trim()} className="flex-1 sm:flex-none">
          Add
        </Button>
        <Button type="button" variant="secondary" size="icon" onClick={onDetails} aria-label="Add with details">
          <PencilSimple />
        </Button>
      </div>
    </form>
  );
}

/** The month's expenses grouped by day, newest first. Seven rows until asked for the rest. */
function ExpenseList({ expenses, onEdit }: { expenses: ExpenseRow[]; onEdit: (e: ExpenseRow) => void }) {
  const { visible, hidden, showAll } = useShowAll(expenses);
  const groups = React.useMemo(() => {
    const out: { day: string; rows: ExpenseRow[] }[] = [];
    for (const e of visible) {
      const last = out[out.length - 1];
      if (last && last.day === e.spentOn) last.rows.push(e);
      else out.push({ day: e.spentOn, rows: [e] });
    }
    return out;
  }, [visible]);
  return (
    <div className="py-2">
      {groups.map((g) => (
        <section key={g.day} aria-label={dayLabel(g.day)}>
          <h3 className="px-4 pt-3 pb-1 text-[12px] font-medium text-muted sm:px-5">{dayLabel(g.day)}</h3>
          <ul>
            {g.rows.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onEdit(e)} className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-hover sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{e.note || e.merchant || categoryLabel(e.category)}</span>
                    <span className="block truncate text-[12px] text-subtle">{[categoryLabel(e.category), e.note ? e.merchant : ""].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="tabular shrink-0 text-[14px]">{formatMoney(e.amountMinor, e.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {hidden ? (
        <div className="px-4 pt-2 sm:px-5">
          <Button variant="quiet" onClick={showAll}>
            Show all {expenses.length}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
