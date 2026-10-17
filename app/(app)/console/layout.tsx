import type { Metadata } from "next";
import { ConsoleNav } from "@/components/admin/parts";
import { requireAdmin } from "@/lib/admin/guard";

export const metadata: Metadata = { title: "Console", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <h1 className="mb-3 font-serif text-[26px] leading-tight tracking-[-0.02em] sm:text-[30px]">Console</h1>
      <ConsoleNav />
      {children}
    </>
  );
}
