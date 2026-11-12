import "server-only";
import { notFound } from "next/navigation";
import { getOwner } from "@/lib/auth/session";
import type { User } from "@/lib/db/schema";
import type { AdminRole, Permission } from "./permissions";
import { can } from "./permissions";
import { getAdminRole } from "./roles";

/**
 * Admin pages answer 404 to everyone else, so the console's existence isn't revealed.
 * With a permission, the account's role must grant it; without one, any admin role will do.
 */
export async function requireAdmin(permission?: Permission): Promise<User & { adminRole: AdminRole }> {
  const user = await getOwner();
  if (!user) notFound();
  const role = await getAdminRole(user);
  if (!role || (permission && !can(role, permission))) notFound();
  return { ...user, adminRole: role };
}
