import type { Icon } from "@phosphor-icons/react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Empty states are helpful, never blank: an icon, one sentence, one clear action. */
export function EmptyState({
  icon: IconCmp,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon: Icon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 py-6" : "gap-3 py-12", className)}>
      <span className="grid size-11 place-items-center rounded-full border border-border bg-surface text-muted">
        <IconCmp size={20} />
      </span>
      <div className="max-w-xs">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="mt-1 text-[13px] text-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, retry, compact }: { message?: string; retry?: React.ReactNode; compact?: boolean }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 text-center", compact ? "py-6" : "py-12")}>
      <span className="inline-flex items-center gap-2 text-sm font-medium">
        <span className="size-2 rounded-full bg-danger" aria-hidden />
        Something went wrong
      </span>
      <p className="max-w-xs text-[13px] text-muted">{message ?? "This section couldn't load. Try again in a moment."}</p>
      {retry}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-serif text-[26px] leading-[1.15] tracking-[-0.02em] sm:text-[32px]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-xl text-[14px] text-muted sm:text-[15px]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
