import Link from "next/link";
import { Logo } from "@/components/layout/logo";

/** Shown by the app layout to people without an admin role while maintenance mode is on. */
export function MaintenanceScreen({ message, endsAt, timeZone }: { message: string; endsAt: string | null; timeZone: string }) {
  const end = endsAt ? new Date(endsAt) : null;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <h1 className="font-serif text-[26px] leading-tight tracking-[-0.02em]">Down for maintenance</h1>
        <p className="mt-3 text-[15px] text-muted">{message}</p>
        {end && !Number.isNaN(end.getTime()) ? (
          <p className="mt-2 text-[13px] text-subtle">
            Expected back by{" "}
            <time dateTime={end.toISOString()}>{formatEnd(end, timeZone)}</time>.
          </p>
        ) : null}
        <Link href="/" className="mt-6 inline-flex h-11 items-center justify-center rounded-[10px] border border-border px-4 text-sm font-medium hover:bg-surface">
          Try again
        </Link>
      </div>
    </main>
  );
}

function formatEnd(d: Date, timeZone: string): string {
  try {
    return d.toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone, timeZoneName: "short" });
  } catch {
    return d.toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC", timeZoneName: "short" });
  }
}
