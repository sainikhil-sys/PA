"use client";

import { motion } from "motion/react";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Segmented control with a shared-element active pill (Motion layoutId). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  id,
  className,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  id: string;
  className?: string;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-[12px] border border-border bg-surface p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn("relative inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium transition-colors", active ? "text-foreground" : "text-muted hover:text-foreground")}
          >
            {active ? <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[9px] border border-border bg-background" transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} /> : null}
            <span className="relative inline-flex items-center gap-1.5">
              {o.icon}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Link-based sub navigation (settings, tasks views). */
export function TabLinks({ items, active, id }: { items: { href: string; label: string }[]; active: string; id: string }) {
  return (
    <nav aria-label="Section" className="no-scrollbar -mx-4 mb-8 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0">
      {items.map((it) => {
        const isActive = it.href === active;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={isActive ? "page" : undefined}
            className={cn("relative inline-flex h-11 shrink-0 items-center px-3 text-sm transition-colors", isActive ? "font-medium text-foreground" : "text-muted hover:text-foreground")}
          >
            {it.label}
            {isActive ? <motion.span layoutId={`tab-${id}`} className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-foreground" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
