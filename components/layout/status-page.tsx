import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Logo } from "./logo";

/**
 * A full-page status message (not found, maintenance): the logo, one heading, one sentence and
 * at most one action. Server component; error pages pass a client action as `children`.
 */
export function StatusPage({ title, message, action, children }: { title: string; message: string; action?: { href: string; label: string }; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto w-full max-w-[760px] px-4 py-4 sm:py-6">
        <Logo size={26} />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center px-4 pb-24">
        <h1 className="font-serif text-[30px] leading-tight sm:text-[36px]">{title}</h1>
        <p className="mt-3 max-w-md text-[15px] leading-7 text-muted">{message}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {action ? (
            <Link href={action.href} className="inline-flex h-10 items-center rounded-[10px] bg-primary px-4 text-sm font-medium text-primary-foreground">
              {action.label}
            </Link>
          ) : null}
          {children}
        </div>
        <p className="mt-10 text-[13px] text-muted">
          Need help? See the <Link href="/help" className="underline hover:text-foreground">help page</Link> or write to{" "}
          <a href={`mailto:${BRAND.supportEmail}`} className="underline hover:text-foreground">{BRAND.supportEmail}</a>.
        </p>
      </main>
    </div>
  );
}
