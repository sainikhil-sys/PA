"use client";

import { Target } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { setBudgetAction } from "@/app/actions/trackers";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/states";
import { CATEGORIES, categoryLabel, formatMoney, fromMinor, toMinor, type CategoryId } from "@/lib/trackers/money";
import { CurrencySelect, Field, Select, useShowAll } from "./fields";

export type CategoryTotal = { currency: string; category: string; minor: number; count: number };
export type Budget = { category: string; currency: string; monthlyMinor: number };

/** A plain monochrome bar. `ratio` is clamped to 0..1. */
function Bar({ ratio, label }: { ratio: number; label: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={label}>
      <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Month totals, one line per currency. Currencies are never added together. */
export function TotalsCard({ totals, monthName }: { totals: { currency: string; minor: number; count: number }[]; monthName: string }) {
  return (
    <Card>
      <CardHeader title="Spent" description={monthName} />
      <CardBody>
        {totals.length ? (
          <ul className="flex flex-col gap-1">
            {totals.map((t) => (
              <li key={t.currency} className="flex items-baseline justify-between gap-3">
                <span className="tabular font-serif text-[28px] leading-tight tracking-[-0.01em]">{formatMoney(t.minor, t.currency)}</span>
                <span className="text-[13px] text-muted">
                  {t.count} {t.count === 1 ? "expense" : "expenses"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">Nothing logged this month.</p>
        )}
        {totals.length > 1 ? <p className="mt-2 text-[12px] text-subtle">Each currency is totalled on its own.</p> : null}
      </CardBody>
    </Card>
  );
}

/** Spend by category, bars relative to the biggest category in the same currency. */
export function CategoriesCard({ categories }: { categories: CategoryTotal[] }) {
  const sorted = React.useMemo(() => [...categories].sort((a, b) => a.currency.localeCompare(b.currency) || b.minor - a.minor), [categories]);
  const max = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const c of categories) m.set(c.currency, Math.max(m.get(c.currency) ?? 0, c.minor));
    return m;
  }, [categories]);
  const multi = max.size > 1;
  const { visible, hidden, showAll } = useShowAll(sorted);
  if (!categories.length) return null;
  return (
    <Card>
      <CardHeader title="By category" />
      <CardBody>
        <ul className="flex flex-col gap-3">
          {visible.map((c) => (
            <li key={`${c.currency}-${c.category}`} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-[14px]">
                <span className="min-w-0 truncate">
                  {categoryLabel(c.category)}
                  {multi ? <span className="text-subtle"> · {c.currency}</span> : null}
                </span>
                <span className="tabular shrink-0">{formatMoney(c.minor, c.currency)}</span>
              </div>
              <Bar ratio={c.minor / (max.get(c.currency) || 1)} label={`${categoryLabel(c.category)}: ${formatMoney(c.minor, c.currency)}`} />
            </li>
          ))}
        </ul>
        {hidden ? (
          <Button variant="quiet" className="mt-3" onClick={showAll}>
            Show {hidden} more
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** Monthly budgets with progress for the selected month, and an honest over-budget line. */
export function BudgetsCard({ budgets, categories, monthName, defaultCurrency }: { budgets: Budget[]; categories: CategoryTotal[]; monthName: string; defaultCurrency: string }) {
  const [editing, setEditing] = React.useState<Budget | "new" | null>(null);
  const spent = (b: Budget) => categories.find((c) => c.category === b.category && c.currency === b.currency)?.minor ?? 0;
  const { visible, hidden, showAll } = useShowAll(budgets);
  return (
    <Card>
      <CardHeader
        title="Budgets"
        description={budgets.length ? `Monthly, for ${monthName}` : undefined}
        action={
          budgets.length ? (
            <Button variant="quiet" size="sm" onClick={() => setEditing("new")}>
              Set a budget
            </Button>
          ) : null
        }
      />
      <CardBody>
        {budgets.length ? (
          <ul className="flex flex-col gap-1">
            {visible.map((b) => {
              const s = spent(b);
              const over = s - b.monthlyMinor;
              return (
                <li key={`${b.currency}-${b.category}`}>
                  <button type="button" onClick={() => setEditing(b)} className="-mx-2 flex min-h-11 w-[calc(100%+16px)] flex-col gap-1.5 rounded-[10px] px-2 py-2 text-left hover:bg-surface-hover">
                    <span className="flex w-full items-baseline justify-between gap-3 text-[14px]">
                      <span className="min-w-0 truncate">{categoryLabel(b.category)}</span>
                      <span className="tabular shrink-0 text-muted">
                        <span className="text-foreground">{formatMoney(s, b.currency)}</span> of {formatMoney(b.monthlyMinor, b.currency)}
                      </span>
                    </span>
                    <Bar ratio={s / b.monthlyMinor} label={`${Math.round((s / b.monthlyMinor) * 100)}% of budget used`} />
                    {over > 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-[13px]">
                        <StatusDot state="error" />
                        Over by {formatMoney(over, b.currency)}
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted">{formatMoney(-over, b.currency)} left</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={Target}
            title="No budgets yet."
            description="Set a monthly limit for a category to see how close you are."
            action={
              <Button size="sm" onClick={() => setEditing("new")}>
                Set a budget
              </Button>
            }
          />
        )}
        {hidden ? (
          <Button variant="quiet" className="mt-3" onClick={showAll}>
            Show {hidden} more
          </Button>
        ) : null}
      </CardBody>
      <BudgetDialog budget={editing === "new" ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} defaultCurrency={defaultCurrency} />
    </Card>
  );
}

function BudgetDialog({ budget, open, onOpenChange, defaultCurrency }: { budget: Budget | null; open: boolean; onOpenChange: (o: boolean) => void; defaultCurrency: string }) {
  const [category, setCategory] = React.useState<string>("food");
  const [currency, setCurrency] = React.useState(defaultCurrency);
  const [amount, setAmount] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();

  React.useEffect(() => {
    if (!open) return;
    setCategory(budget?.category ?? "food");
    setCurrency(budget?.currency ?? defaultCurrency);
    setAmount(budget ? fromMinor(budget.monthlyMinor, budget.currency) : "");
    setError(null);
  }, [open, budget, defaultCurrency]);

  const submit = (monthlyMinor: number | null) =>
    start(async () => {
      const res = await setBudgetAction({ category: category as CategoryId, currency, monthlyMinor });
      if (!res.ok) return void setError(res.error);
      toast.success(monthlyMinor === null ? "Budget removed" : "Budget saved");
      onOpenChange(false);
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={budget ? `${categoryLabel(budget.category)} budget` : "Set a budget"}
      description="A monthly limit for one category in one currency."
      footer={
        <>
          {budget ? (
            <Button variant="danger" className="sm:mr-auto" disabled={pending} onClick={() => submit(null)}>
              Remove
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="budget-form" disabled={pending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="budget-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const minor = toMinor(amount, currency);
          if (minor === null) return setError("Enter a monthly amount above zero.");
          submit(minor);
        }}
      >
        <Field label="Category" htmlFor="budget-category">
          <Select id="budget-category" value={category} disabled={Boolean(budget)} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Field label="Per month" htmlFor="budget-amount" className="flex-1">
            <Input id="budget-amount" inputMode="decimal" autoComplete="off" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="Currency" htmlFor="budget-currency" className="w-28">
            <CurrencySelect id="budget-currency" value={currency} onChange={setCurrency} disabled={Boolean(budget)} />
          </Field>
        </div>
        <FieldError>{error}</FieldError>
      </form>
    </Dialog>
  );
}
