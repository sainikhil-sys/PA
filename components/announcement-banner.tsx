"use client";

import { X } from "@phosphor-icons/react";
import Link from "next/link";
import * as React from "react";
import type { ClientAnnouncement } from "@/lib/config/client";
import { cn } from "@/lib/utils";

/** Announcements from the console, shown above the page. Hiding one is remembered on every device. */
export function AnnouncementBanner({ items }: { items: ClientAnnouncement[] }) {
  const [hidden, setHidden] = React.useState<string[]>([]);
  const visible = items.filter((a) => !hidden.includes(a.id));
  if (!visible.length) return null;

  const dismiss = (id: string) => {
    setHidden((h) => [...h, id]);
    void fetch(`/api/config/announcements/${id}/dismiss`, { method: "POST" }).catch(() => {});
  };

  return (
    <div className="mb-4 flex flex-col gap-2">
      {visible.map((a) => (
        <div
          key={a.id}
          role={a.severity === "critical" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-3 rounded-[12px] border bg-background px-3.5 py-3 text-[13.5px]",
            a.severity === "critical" ? "border-danger/50" : a.severity === "warning" ? "border-warning/50" : "border-border",
          )}
        >
          <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-[2px]", a.severity === "critical" ? "bg-danger" : a.severity === "warning" ? "bg-warning" : "bg-foreground/50")} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{a.title}</p>
            <p className="text-muted">{a.body}</p>
            {a.href && /^\/(?!\/)/.test(a.href) ? (
              <Link href={a.href} className="mt-1 inline-block text-[13px] underline underline-offset-4">
                Open
              </Link>
            ) : null}
          </div>
          {a.dismissible ? (
            <button type="button" aria-label="Hide this announcement" onClick={() => dismiss(a.id)} className="rounded-[8px] p-1 text-muted hover:bg-surface-hover hover:text-foreground">
              <X size={16} />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
