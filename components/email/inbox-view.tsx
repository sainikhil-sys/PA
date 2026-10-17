"use client";

import { ArrowClockwise, Tray } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { syncInboxNowAction } from "@/app/actions/email";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Segmented } from "@/components/ui/tabs";
import type { EmailCategory } from "@/lib/db/schema";
import { fetcher } from "@/lib/fetcher";
import { cn, timeAgo } from "@/lib/utils";
import { CategoryBadge } from "./category-badge";
import { EmailActions } from "./email-actions";

export type InboxRow = { id: string; fromName: string | null; fromEmail: string | null; subject: string; summary: string | null; snippet: string; category: EmailCategory | null; receivedAt: string; draftId: string | null };

type Filter = "important" | EmailCategory | "all";

export function InboxView({ initial, counts, connected, syncError }: { initial: InboxRow[]; counts: Record<string, number>; connected: boolean; syncError?: string | null }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>("important");
  const [pending, start] = React.useTransition();
  const { data, mutate } = useSWR<{ items: InboxRow[] }>(`/api/emails?filter=${filter}`, fetcher, { fallbackData: filter === "important" ? { items: initial } : undefined, refreshInterval: 10_000 });

  const sync = () =>
    start(async () => {
      const res = await syncInboxNowAction({});
      if (!res.ok) return void toast.error(res.error);
      toast.success("Inbox synced");
      void mutate();
      router.refresh();
    });

  const items = data?.items ?? [];
  const options: { value: Filter; label: string }[] = [
    { value: "important", label: `Needs you · ${(counts.URGENT ?? 0) + (counts.REPLY_NEEDED ?? 0)}` },
    { value: "FYI", label: `FYI · ${counts.FYI ?? 0}` },
    { value: "NEWSLETTER", label: `Newsletters · ${counts.NEWSLETTER ?? 0}` },
    { value: "SPAM", label: `Spam · ${counts.SPAM ?? 0}` },
    { value: "all", label: "All" },
  ];

  if (!connected) {
    return <EmptyState icon={Tray} title="Connect Gmail" description="Cowork reads your inbox, sorts it, and prepares reply drafts. It never sends." action={<Button asChild variant="primary"><a href="/api/integrations/google/start?returnTo=/inbox">Connect Google</a></Button>} />;
  }

  return (
    <div className="flex flex-col gap-5">
      {syncError ? (
        <p role="alert" className="flex items-start gap-2 rounded-[12px] border border-border px-4 py-3 text-[13px]">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
          {syncError}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Segmented id="inbox-filter" label="Filter" value={filter} onChange={setFilter} options={options} />
        </div>
        <Button size="sm" onClick={sync} disabled={pending}>
          <ArrowClockwise className={cn(pending && "motion-safe:animate-spin")} /> {pending ? "Syncing…" : "Sync now"}
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Tray} title={filter === "important" ? "Nothing needs you" : "Nothing here"} description={filter === "important" ? "No urgent or reply-needed email right now." : "New mail is sorted automatically every few minutes."} />
      ) : (
        <ul className="divide-y divide-border rounded-[16px] border border-border">
          {items.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{e.fromName ?? e.fromEmail}</p>
                  <span className="tabular shrink-0 text-[12px] text-subtle">{timeAgo(e.receivedAt)}</span>
                </div>
                <p className={cn("truncate text-[13px]", e.category === "SPAM" ? "text-subtle line-through" : "text-muted")}>{e.subject}</p>
                <p className="mt-1 line-clamp-2 text-[13px]">{e.summary ?? e.snippet}</p>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                <CategoryBadge category={e.category} />
                {e.category === "URGENT" || e.category === "REPLY_NEEDED" ? <EmailActions id={e.id} hasDraft={Boolean(e.draftId)} compact /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-subtle">Summaries are written from your emails by your AI provider. Drafts are saved in Gmail for you to review and send yourself.</p>
    </div>
  );
}
