import { AnnouncementActions, CancelScheduledBroadcast, NewAnnouncement } from "@/components/admin/announcements-editor";
import { Table } from "@/components/admin/parts";
import { requireAdmin } from "@/lib/admin/guard";
import { listAnnouncements, listScheduledBroadcasts, type AnnouncementRow } from "@/lib/admin/ops/announcements";
import type { FlagTargeting } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const utc = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const STATUS: Record<AnnouncementRow["status"], string> = { scheduled: "Scheduled", live: "Live", ended: "Ended", archived: "Archived" };
const SEVERITY = { info: "Information", warning: "Warning", critical: "Critical" } as const;
const SEGMENT: Record<NonNullable<FlagTargeting["segments"]>[number], string> = { admins: "admins", beta: "beta testers", new_users_30d: "joined in the last 30 days", signed_up_before: "joined before" };

function audience(t: FlagTargeting): string {
  const parts: string[] = [];
  if (t.platforms?.length) parts.push(t.platforms.map((p) => (p === "android" ? "Android app" : "Website")).join(" and "));
  if (t.segments?.length) parts.push(t.segments.map((s) => (s === "signed_up_before" && t.signedUpBefore ? `joined before ${t.signedUpBefore.slice(0, 10)}` : SEGMENT[s])).join(" or "));
  if (t.minAppVersion || t.maxAppVersion) parts.push(`app ${t.minAppVersion ?? "any"} to ${t.maxAppVersion ?? "latest"}`);
  if (t.allowUserIds?.length) parts.push(`plus ${t.allowUserIds.length} named`);
  if (t.denyUserIds?.length) parts.push(`minus ${t.denyUserIds.length} named`);
  return parts.length ? parts.join(", ") : "Everyone";
}

export default async function ConsoleAnnouncements() {
  await requireAdmin("notifications.send");
  const [rows, scheduled] = await Promise.all([listAnnouncements().catch(() => null), listScheduledBroadcasts().catch(() => null)]);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-muted">Banners and home cards that stay up for a time window. For a one-time message to everyone, use Broadcast.</p>
      <NewAnnouncement />

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-medium">Announcements</h2>
        {!rows ? (
          <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">Unavailable: the database didn&apos;t answer. Try again in a minute.</p>
        ) : (
          <Table
            empty="No announcements yet."
            head={["Announcement", "Status", "Window", "Who sees it", "Dismissed", ""]}
            rows={rows.map((a) => [
              <div key="t" className="max-w-[300px]">
                <p className="truncate font-medium">{a.title}</p>
                <p className="truncate text-[12px] text-muted">
                  {SEVERITY[a.severity]}, {a.placement === "banner" ? "banner" : "home card"}
                  {a.href ? `, opens ${a.href}` : ""}
                  {a.dismissible ? "" : ", can't be dismissed"}
                </p>
              </div>,
              <span key="s" className={cn(a.status === "live" ? "font-medium" : "text-muted", a.status === "live" && a.severity === "critical" && "text-danger")}>
                {STATUS[a.status]}
              </span>,
              <span key="w" className="tabular whitespace-nowrap text-[12px] text-muted">
                {utc(a.startsAt)}
                <br />
                {a.endsAt ? `to ${utc(a.endsAt)}` : "no end"}
              </span>,
              <span key="a" className="line-clamp-2 max-w-[220px] text-[12px] text-muted">
                {audience(a.targeting ?? {})}
              </span>,
              <span key="d" className="tabular text-muted">
                {a.dismissals}
              </span>,
              <AnnouncementActions
                key="x"
                archived={a.status === "archived"}
                announcement={{ id: a.id, title: a.title, body: a.body, severity: a.severity, placement: a.placement, href: a.href, dismissible: a.dismissible, startsAt: a.startsAt, endsAt: a.endsAt, targeting: a.targeting ?? {} }}
              />,
            ])}
          />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-medium">Scheduled broadcasts</h2>
        {!scheduled ? (
          <p className="rounded-[14px] border border-border p-4 text-[13px] text-muted">Unavailable: the database didn&apos;t answer. Try again in a minute.</p>
        ) : (
          <Table
            empty="No broadcasts are waiting to be sent."
            head={["Broadcast", "Channels", "Sends at", ""]}
            rows={scheduled.map((b) => [
              <span key="t" className="block max-w-[320px] truncate font-medium">
                {b.title}
              </span>,
              <span key="c" className="text-muted">
                {b.channels.map((c) => (c === "in_app" ? "In-app" : c === "push" ? "Phones" : "Email")).join(", ")}
              </span>,
              <span key="w" className="tabular text-muted">
                {utc(b.sendAt)}
              </span>,
              <CancelScheduledBroadcast key="x" id={b.id} />,
            ])}
          />
        )}
      </section>
    </div>
  );
}
