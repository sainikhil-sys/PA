import { cookies } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { BRAND } from "@/lib/brand";

/** Public pages (home, privacy, terms): readable without signing in. */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // Cookie presence only (cheap): a stale cookie just lands on /login after the click.
  const jar = await cookies();
  const signedIn = jar.has("__Host-pa_session") || jar.has("pa_session");
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-[760px] items-center justify-between px-4 py-4 sm:py-6">
        <Link href="/home" aria-label={`${BRAND.name} home`}>
          <Logo size={26} />
        </Link>
        <Link href={signedIn ? "/" : "/login"} className="rounded-[10px] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          {signedIn ? "Open dashboard" : "Sign in"}
        </Link>
      </header>
      <main id="main" className="mx-auto max-w-[760px] px-4 pb-16">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}

function PublicFooter() {
  return (
    <footer className="mx-auto flex max-w-[760px] flex-wrap gap-x-6 gap-y-2 border-t border-border px-4 py-8 text-[13px] text-muted">
      <span>© {new Date().getFullYear()} {BRAND.name}</span>
      <Link href="/home" className="hover:text-foreground">Home</Link>
      <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
      <Link href="/terms" className="hover:text-foreground">Terms</Link>
      <a href={`mailto:${BRAND.supportEmail}`} className="hover:text-foreground">{BRAND.supportEmail}</a>
    </footer>
  );
}
