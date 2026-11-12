"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * What an error boundary shows: what happened, a retry, and a reference people can quote to
 * support (the digest Next.js logs on the server; no error text reaches the page).
 */
export function ErrorView({ digest, reset, home = true }: { digest?: string; reset: () => void; home?: boolean }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-start py-16">
      <h1 className="font-serif text-[28px] leading-tight">Something went wrong</h1>
      <p className="mt-3 text-[15px] leading-7 text-muted">This page couldn&apos;t load. Try again; if it keeps happening, write to support and quote the reference below.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        {home ? (
          <Button asChild variant="ghost">
            <Link href="/">Go to Cowork</Link>
          </Button>
        ) : null}
      </div>
      {digest ? <p className="mt-8 font-mono text-[12px] text-muted">Reference {digest}</p> : null}
    </div>
  );
}
