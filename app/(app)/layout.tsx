import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { AppShell } from "@/components/layout/app-shell";
import { MaintenanceScreen } from "@/components/maintenance-screen";
import { requireOwner } from "@/lib/auth/session";
import { pendingProposalCount } from "@/lib/agent/proposals";
import { announcementsFor } from "@/lib/config/client";
import { maintenanceBlock } from "@/lib/config/enforce";
import { getSettings } from "@/lib/db/queries/settings";
import { flagContext } from "@/lib/flags/store";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOwner();
  // Maintenance mode: everyone except admins sees the maintenance screen (admins can still reach the console).
  const blocked = await maintenanceBlock(user);
  if (blocked) {
    const tz = await getSettings(user.id)
      .then((s) => s.timezone)
      .catch(() => "UTC");
    return <MaintenanceScreen message={blocked.message} endsAt={blocked.endsAt} timeZone={tz} />;
  }
  if (!user.onboardedAt) redirect("/onboarding");
  const [s, pending, announcements] = await Promise.all([
    getSettings(user.id),
    pendingProposalCount(user.id).catch(() => 0),
    flagContext(user, await headers())
      .then((ctx) => announcementsFor(ctx))
      .then((list) => list.filter((a) => a.placement === "banner"))
      .catch(() => []),
  ]);
  return (
    <AppShell
      user={{ name: user.name, email: user.email, avatarUrl: user.avatarUrl, timezone: s.timezone, agentName: s.agent.name }}
      prefs={{ reduceMotion: s.reduceMotion, fontScale: s.fontScale, density: s.density, linkPanel: s.linkPanel }}
      badges={{ "/approvals": pending }}
    >
      {announcements.length ? <AnnouncementBanner items={announcements} /> : null}
      {children}
    </AppShell>
  );
}
