"use client";

import { ErrorView } from "@/components/layout/error-view";

/** Errors in public pages and anything outside the signed-in shell. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="min-h-dvh bg-background px-4">
      <ErrorView digest={error.digest} reset={reset} />
    </main>
  );
}
