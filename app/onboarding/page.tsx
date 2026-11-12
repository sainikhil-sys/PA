import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { requireOwner } from "@/lib/auth/session";
import { getGoogleStatus, getSettings } from "@/lib/db/queries/settings";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const user = await requireOwner();
  if (user.onboardedAt) redirect("/");
  const [settings, google, sp] = await Promise.all([getSettings(user.id), getGoogleStatus(user.id), searchParams]);
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-surface px-4 py-12">
      <OnboardingFlow
        initial={{ name: user.name ?? "", timezone: settings.timezone, personality: settings.agent.personality, agentName: settings.agent.name, needsBirthDate: !user.birthDate }}
        googleConnected={google.connected}
        resumeAtConnect={sp.connected === "google"}
      />
    </main>
  );
}
