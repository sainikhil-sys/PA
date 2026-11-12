import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { can, type AdminRole, type Permission } from "./permissions";

type RoleUser = Pick<User, "id" | "disabledAt">;

/**
 * The active admin role this account holds, or null. Only admin_role_assignments counts: ADMIN_EMAILS
 * grants nothing. Disabled accounts hold none. If the lookup fails, nobody is an admin (fails closed).
 * Cached per request.
 */
export const getAdminRole = cache(async (user: RoleUser): Promise<AdminRole | null> => {
  if (user.disabledAt) return null;
  try {
    const [row] = await db()
      .select({ role: schema.adminRoleAssignments.role })
      .from(schema.adminRoleAssignments)
      .where(and(eq(schema.adminRoleAssignments.userId, user.id), isNull(schema.adminRoleAssignments.revokedAt)))
      .limit(1);
    return row?.role ?? null;
  } catch {
    return null;
  }
});

/** Whether this account may do this. Always checked on the server, per request. */
export async function hasPermission(user: RoleUser, permission: Permission): Promise<boolean> {
  return can(await getAdminRole(user), permission);
}
