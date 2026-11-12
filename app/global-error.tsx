"use client";

import { ErrorView } from "@/components/layout/error-view";
import "./globals.css";

/** Last resort: the root layout itself failed, so this renders its own document. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background px-4 text-foreground antialiased">
        <ErrorView digest={error.digest} reset={reset} />
      </body>
    </html>
  );
}
