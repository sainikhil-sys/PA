import * as React from "react";
import { cn } from "@/lib/utils";

export function Section({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-b border-border py-5 first:pt-0 last:border-0 sm:py-7", className)}>
      <div className="mb-3 sm:mb-4">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {description ? <p className="mt-1 text-[13px] text-muted">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    // Label and control share a line; wide controls (inputs, selects) wrap below on narrow screens.
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 flex-1 basis-[200px]">
        <label htmlFor={htmlFor} className="text-sm">
          {label}
        </label>
        {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
      </div>
      <div className="max-w-full shrink-0 sm:max-w-[320px] sm:text-right">{children}</div>
    </div>
  );
}
