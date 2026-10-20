"use client";

import * as React from "react";
import { inputClass, Label } from "@/components/ui/input";
import { CURRENCIES, CURRENCY_RE } from "@/lib/trackers/money";
import { cn } from "@/lib/utils";

/** Label above a control, with the hint or error below. */
export function Field({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputClass, "appearance-auto pr-2", className)} {...props} />;
}

/** At most `limit` items until the person asks for the rest (taste rule: 7 per list). */
export function useShowAll<T>(items: T[], limit = 7) {
  const [all, setAll] = React.useState(false);
  return { visible: all ? items : items.slice(0, limit), hidden: all ? 0 : Math.max(0, items.length - limit), showAll: () => setAll(true) };
}

const STORAGE_KEY = "pa.trackers.currency";

/** Currency for new entries, remembered per browser. Storage may be blocked, so every access is guarded. */
export function useStoredCurrency(): [string, (c: string) => void] {
  const [currency, setCurrency] = React.useState("INR");
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && CURRENCY_RE.test(saved)) setCurrency(saved);
    } catch {
      // Private mode or blocked storage: keep the default.
    }
  }, []);
  const update = React.useCallback((c: string) => {
    setCurrency(c);
    try {
      window.localStorage.setItem(STORAGE_KEY, c);
    } catch {
      // Not remembered, still used for this session.
    }
  }, []);
  return [currency, update];
}

export function CurrencySelect({ value, onChange, id, className, disabled }: { value: string; onChange: (c: string) => void; id: string; className?: string; disabled?: boolean }) {
  const options = (CURRENCIES as readonly string[]).includes(value) ? CURRENCIES : [value, ...CURRENCIES];
  return (
    <Select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={className} aria-label="Currency">
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  );
}
