import * as React from "react";
import { cn } from "@/lib/utils";

export function Section({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-b border-border py-8 first:pt-0 last:border-0", className)}>
      <div className="mb-5">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {description ? <p className="mt-1 text-[13px] text-muted">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-sm">
          {label}
        </label>
        {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
      </div>
      <div className="shrink-0 sm:max-w-[320px] sm:flex-1 sm:text-right">{children}</div>
    </div>
  );
}
