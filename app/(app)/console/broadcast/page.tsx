import { BroadcastComposer } from "@/components/admin/broadcast-composer";
import { Table } from "@/components/admin/parts";
import { fileCounts } from "@/lib/admin/broadcast-files";
import { requireAdmin } from "@/lib/admin/guard";
import { broadcastAudience, listBroadcasts } from "@/lib/admin/stats";
import { appUrl } from "@/lib/env";
import { timeAgo } from "@/lib/utils";

export default async function ConsoleBroadcast() {
  await requireAdmin("notifications.send");
  const [audience, history] = await Promise.all([broadcastAudience(), listBroadcasts()]);
  const files = await fileCounts(history.map((b) => b.id));
  return (
    <div className="flex flex-col gap-4">
      <BroadcastComposer audience={audience} appBase={appUrl()} />
      <div>
        <h2 className="mb-2 text-[15px] font-medium">Sent</h2>
        <Table
          empty="No announcements yet."
          head={["Announcement", "Status", "In-app", "Phones", "Email", "When"]}
          rows={history.map((b) => [
            <div key="t" className="max-w-[320px]">
              <p className="truncate font-medium">{b.title}</p>
              <p className="truncate text-[12px] text-muted">
                {b.email ? `Email: ${b.email.subject}` : b.body}
                {files.get(b.id) ? ` · ${files.get(b.id)} file${files.get(b.id) === 1 ? "" : "s"}` : ""}
              </p>
            </div>,
            <span key="s" className="capitalize">{b.status}</span>,
            <span key="i" className="tabular">{b.sentInApp}</span>,
            <span key="p" className="tabular">{b.sentPush}</span>,
            <span key="e" className="tabular">{b.sentEmail}</span>,
            <span key="w" className="text-muted">{timeAgo(b.createdAt.toISOString())}</span>,
          ])}
        />
      </div>
    </div>
  );
}
