import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginFlow } from "@/components/auth/login-flow";
import { getOwner } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getOwner().catch(() => null);
  if (user) redirect(user.onboardedAt ? "/" : "/onboarding");
  const { next } = await searchParams;
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-surface px-4 py-12">
      <LoginFlow next={next} />
    </main>
  );
}
