"use client";

import { ErrorView } from "@/components/layout/error-view";

/** Errors inside the signed-in app: the sidebar and navigation stay, only the page is replaced. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView digest={error.digest} reset={reset} />;
}
