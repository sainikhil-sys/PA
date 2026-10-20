"use client";

import { Trash } from "@phosphor-icons/react";
import * as React from "react";
import { toast } from "sonner";
import { createExpenseAction, deleteExpenseAction, updateExpenseAction } from "@/app/actions/trackers";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, Input } from "@/components/ui/input";
import { CATEGORIES, fromMinor, toMinor, type CategoryId } from "@/lib/trackers/money";
import { CurrencySelect, Field, Select } from "./fields";

export type ExpenseRow = { id: string; amountMinor: number; currency: string; category: string; merchant: string; note: string; spentOn: string };

/** Add or edit one expense. Delete sits behind its own confirm. */
export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  defaultCurrency,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: ExpenseRow | null;
  defaultCurrency: string;
  today: string;
}) {
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState(defaultCurrency);
  const [category, setCategory] = React.useState<string>("other");
  const [merchant, setMerchant] = React.useState("");
  const [note, setNote] = React.useState("");
  const [spentOn, setSpentOn] = React.useState(today);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [pending, start] = React.useTransition();

  // Reset the fields each time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setAmount(expense ? fromMinor(expense.amountMinor, expense.currency) : "");
    setCurrency(expense?.currency ?? defaultCurrency);
    setCategory(expense?.category ?? "other");
    setMerchant(expense?.merchant ?? "");
    setNote(expense?.note ?? "");
    setSpentOn(expense?.spentOn ?? today);
    setError(null);
  }, [open, expense, defaultCurrency, today]);

  const save = () =>
    start(async () => {
      const minor = toMinor(amount, currency);
      if (minor === null) return void setError("Enter an amount above zero, with no more decimals than the currency uses.");
      const input = { amountMinor: minor, currency, category: category as CategoryId, merchant, note, spentOn };
      const res = expense ? await updateExpenseAction({ id: expense.id, ...input }) : await createExpenseAction(input);
      if (!res.ok) return void setError(res.error);
      toast.success(expense ? "Expense updated" : "Expense added");
      onOpenChange(false);
    });

  const remove = () =>
    start(async () => {
      if (!expense) return;
      const res = await deleteExpenseAction({ id: expense.id });
      if (!res.ok) return void toast.error(res.error);
      setConfirmDelete(false);
      onOpenChange(false);
      toast.success("Expense deleted");
    });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={expense ? "Edit expense" : "Add expense"}
        footer={
          <>
            {expense ? (
              <Button variant="danger" className="sm:mr-auto" onClick={() => setConfirmDelete(true)} disabled={pending}>
                <Trash /> Delete
              </Button>
            ) : null}
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form="expense-form" disabled={pending}>
              {expense ? "Save" : "Add"}
            </Button>
          </>
        }
      >
        <form
          id="expense-form"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex gap-2 sm:col-span-2">
            <Field label="Amount" htmlFor="exp-amount" className="flex-1">
              <Input id="exp-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="tabular" required />
            </Field>
            <Field label="Currency" htmlFor="exp-currency" className="w-28">
              <CurrencySelect id="exp-currency" value={currency} onChange={setCurrency} />
            </Field>
          </div>
          <Field label="Category" htmlFor="exp-category">
            <Select id="exp-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" htmlFor="exp-date">
            <Input id="exp-date" type="date" value={spentOn} max={today} onChange={(e) => setSpentOn(e.target.value)} required />
          </Field>
          <Field label="Merchant" htmlFor="exp-merchant">
            <Input id="exp-merchant" value={merchant} maxLength={80} onChange={(e) => setMerchant(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Note" htmlFor="exp-note">
            <Input id="exp-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </Field>
          <div className="sm:col-span-2">
            <FieldError>{error}</FieldError>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this expense?"
        description="It will be removed from this month's totals. This can't be undone."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="primary" disabled={pending} onClick={remove}>
              Delete
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}
