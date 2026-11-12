import Link from "next/link";

/** One page for every 404, so a hidden route looks exactly like a missing one. */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-[480px] flex-col items-start justify-center gap-3 px-4">
      <p className="tabular text-[13px] text-muted">404</p>
      <h1 className="font-serif text-[28px] leading-tight tracking-[-0.02em]">This page could not be found.</h1>
      <p className="text-[15px] text-muted">Check the address, or go back to Cowork.</p>
      <Link href="/" className="text-[15px] underline underline-offset-4">
        Go to Cowork
      </Link>
    </main>
  );
}
