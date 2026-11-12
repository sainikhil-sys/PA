import type { Metadata } from "next";
import { ConsoleNav } from "@/components/admin/parts";
import { requireAdmin } from "@/lib/admin/guard";
import { can, type Permission } from "@/lib/admin/permissions";

/** The permission each console page needs; the page itself checks it again. */
const TAB_PERMISSION: Record<string, Permission> = {
  "/console": "overview.read",
  "/console/users": "users.read",
  "/console/broadcast": "notifications.send",
  "/console/ai": "ai.read",
  "/console/system": "infra.read",
};

export const metadata: Metadata = { title: "Console", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { adminRole } = await requireAdmin();
  const allowed = Object.keys(TAB_PERMISSION).filter((href) => can(adminRole, TAB_PERMISSION[href]!));
  return (
    <>
      <h1 className="mb-3 font-serif text-[26px] leading-tight tracking-[-0.02em] sm:text-[30px]">Console</h1>
      <ConsoleNav allowed={allowed} />
      {children}
    </>
  );
}
