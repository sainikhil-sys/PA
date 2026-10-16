import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/queries/settings";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOwner();
  if (!user.onboardedAt) redirect("/onboarding");
  const s = await getSettings(user.id);
  return (
    <AppShell
      user={{ name: user.name, email: user.email, avatarUrl: user.avatarUrl, timezone: s.timezone, agentName: s.agent.name }}
      prefs={{ reduceMotion: s.reduceMotion, fontScale: s.fontScale, density: s.density, linkPanel: s.linkPanel }}
    >
      {children}
    </AppShell>
  );
}
