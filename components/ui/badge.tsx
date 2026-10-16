import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Status is distinguished by fill/outline/dash + an icon + a text label, never by color alone. */
const badgeVariants = cva(
  "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium leading-none [&_svg]:size-3.5",
  {
    variants: {
      variant: {
        solid: "bg-primary text-primary-foreground",
        outline: "border border-foreground/80 text-foreground",
        soft: "bg-surface-2 text-foreground",
        dashed: "border border-dashed border-border-strong text-muted",
        muted: "text-subtle line-through decoration-subtle/60",
      },
    },
    defaultVariants: { variant: "soft" },
  },
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Tiny semantic dot (one of the few places color is allowed). */
export function StatusDot({ state, pulse, label }: { state: "ok" | "error" | "warn" | "idle"; pulse?: boolean; label?: string }) {
  const color = { ok: "bg-success", error: "bg-danger", warn: "bg-warning", idle: "bg-border-strong" }[state];
  return (
    <span className="relative inline-flex size-2 shrink-0" role={label ? "img" : undefined} aria-label={label}>
      {pulse && state === "ok" ? (
        <span className={cn("absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping", color)} aria-hidden />
      ) : null}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} aria-hidden />
    </span>
  );
}
