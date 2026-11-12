import type { Metadata } from "next";
import { ConsoleNav } from "@/components/admin/parts";
import { LockButton } from "@/components/admin/step-up";
import { getAdminSession } from "@/lib/admin/admin-session";
import { requireAdminRole } from "@/lib/admin/guard";
import { CONSOLE_PAGES } from "@/lib/admin/nav";
import { can } from "@/lib/admin/permissions";
import { getAdminRole } from "@/lib/admin/roles";
import { getOwner } from "@/lib/auth/session";

/** The title only for role holders: everyone else gets the same page title as any missing page. */
export async function generateMetadata(): Promise<Metadata> {
  const user = await getOwner();
  const role = user ? await getAdminRole(user) : null;
  return role ? { title: "Console", robots: { index: false, follow: false } } : { robots: { index: false, follow: false } };
}
export const dynamic = "force-dynamic";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", moderator: "Moderator", support: "Support", analyst: "Analyst" } as const;

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { adminRole } = await requireAdminRole();
  const unlocked = Boolean(await getAdminSession());
  const tabs = CONSOLE_PAGES.filter((p) => can(adminRole, p.permission)).map(({ href, label }) => ({ href, label }));
  return (
    <>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h1 className="font-serif text-[26px] leading-tight tracking-[-0.02em] sm:text-[30px]">Console</h1>
        {unlocked ? (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span>{ROLE_LABEL[adminRole]}. Locks after 15 minutes without activity.</span>
            <LockButton />
          </div>
        ) : null}
      </div>
      {unlocked ? <ConsoleNav tabs={tabs} /> : null}
      {children}
    </>
  );
}
