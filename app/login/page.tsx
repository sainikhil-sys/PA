import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginFlow } from "@/components/auth/login-flow";
import { BRAND } from "@/lib/brand";
import { publicPage } from "@/lib/seo";
import { getOwner } from "@/lib/auth/session";

export const metadata: Metadata = publicPage({ title: "Sign in", description: `Sign in or create your ${BRAND.name} account with a one-time email code. No password needed.`, path: "/login" });
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getOwner().catch(() => null);
  if (user) redirect(user.onboardedAt ? "/" : "/onboarding");
  const { next } = await searchParams;
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-surface px-4 py-12">
      <div className="flex w-full flex-col items-center gap-6">
        <LoginFlow next={next} />
        <nav aria-label="Legal" className="flex gap-5 text-[12px] text-muted">
          <Link href="/home" className="hover:text-foreground">About</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
        </nav>
      </div>
    </main>
  );
}
