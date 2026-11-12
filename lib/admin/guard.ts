import "server-only";
import { notFound, redirect } from "next/navigation";
import { getOwner } from "@/lib/auth/session";
import type { User } from "@/lib/db/schema";
import { getAdminSession, type AdminSession } from "./admin-session";
import type { AdminRole, Permission } from "./permissions";
import { can } from "./permissions";
import { getAdminRole } from "./roles";

/**
 * For console pages. No role: 404, so the console's existence isn't revealed. No valid admin session:
 * the unlock page. With a permission, the role must grant it (404 otherwise; the nav never links there).
 */
export async function requireAdmin(permission?: Permission): Promise<User & { adminRole: AdminRole; adminSession: AdminSession }> {
  const user = await requireAdminRole();
  if (permission && !can(user.adminRole, permission)) notFound();
  const adminSession = await getAdminSession();
  if (!adminSession) redirect("/console/unlock");
  return { ...user, adminSession };
}

/** Role holder check only, for the layout and the unlock page (which must render while locked). */
export async function requireAdminRole(): Promise<User & { adminRole: AdminRole }> {
  const user = await getOwner();
  if (!user) notFound();
  const role = await getAdminRole(user);
  if (!role) notFound();
  return { ...user, adminRole: role };
}
