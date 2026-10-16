"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 6-digit code input: auto-advance, backspace to previous, arrow keys,
 * paste of the whole code, one-time-code autofill, and screen-reader labels.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  length = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  length?: number;
}) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  React.useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const setAt = (index: number, char: string) => {
    const next = digits.slice();
    next[index] = char;
    const joined = next.join("").slice(0, length);
    onChange(joined);
    if (joined.length === length && !joined.includes("")) onComplete?.(joined);
  };

  const fill = (raw: string, start = 0) => {
    const clean = raw.replace(/\D/g, "").slice(0, length - start);
    if (!clean) return;
    const next = digits.slice();
    for (let i = 0; i < clean.length; i++) next[start + i] = clean[i]!;
    const joined = next.join("");
    onChange(joined);
    refs.current[Math.min(start + clean.length, length - 1)]?.focus();
    if (joined.length === length) onComplete?.(joined);
  };

  return (
    <div className="flex justify-center gap-2 sm:gap-2.5" role="group" aria-label="Verification code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          pattern="[0-9]*"
          maxLength={length}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          value={d}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (v.length > 1) return fill(v, i); // autofill / fast typing
            setAt(i, v);
            if (v && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) {
              e.preventDefault();
              setAt(i - 1, "");
              refs.current[i - 1]?.focus();
            } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            fill(e.clipboardData.getData("text"), 0);
          }}
          className={cn(
            "tabular h-14 w-11 rounded-[12px] border bg-background text-center text-[22px] font-medium outline-none transition-colors duration-150 sm:w-12",
            "focus:border-foreground focus:ring-2 focus:ring-foreground/10 disabled:opacity-50",
            invalid ? "border-danger" : d ? "border-border-strong" : "border-border",
          )}
        />
      ))}
    </div>
  );
}
