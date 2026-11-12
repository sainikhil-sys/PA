import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { isAdmin } from "@/lib/auth/policy";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { can, type AdminRole, type Permission } from "./permissions";
import { resolveAdminRole } from "./role-resolve";

/** True once the owner has been bootstrapped. Cached per request. */
export const ownerExists = cache(async (): Promise<boolean> => {
  const [row] = await db().select({ id: schema.adminRoleAssignments.userId }).from(schema.adminRoleAssignments).where(eq(schema.adminRoleAssignments.role, "owner")).limit(1);
  return Boolean(row);
});

/** The admin role this account holds, or null. Disabled accounts hold none. Cached per request. */
export const getAdminRole = cache(async (user: Pick<User, "id" | "email" | "disabledAt">): Promise<AdminRole | null> => {
  if (user.disabledAt) return null;
  const [row] = await db().select({ role: schema.adminRoleAssignments.role }).from(schema.adminRoleAssignments).where(eq(schema.adminRoleAssignments.userId, user.id)).limit(1);
  const assigned = row?.role ?? null;
  return resolveAdminRole({ assigned, ownerExists: assigned ? true : await ownerExists(), listedInAdminEmails: isAdmin(user.email) });
});

/** Whether this account may do this. Always checked on the server, per request. */
export async function hasPermission(user: Pick<User, "id" | "email" | "disabledAt">, permission: Permission): Promise<boolean> {
  return can(await getAdminRole(user), permission);
}
