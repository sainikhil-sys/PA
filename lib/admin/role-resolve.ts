import type { AdminRole } from "./permissions";

/**
 * Which admin role an account holds. Pure so it is unit tested.
 *
 * - A row in admin_role_assignments always decides.
 * - Before any owner has been bootstrapped, an address listed in ADMIN_EMAILS acts as "admin" so the
 *   existing console keeps working through the switch. Once an owner exists, ADMIN_EMAILS grants
 *   nothing: it is only the list the bootstrap script accepts.
 */
export function resolveAdminRole(input: { assigned: AdminRole | null; ownerExists: boolean; listedInAdminEmails: boolean }): AdminRole | null {
  if (input.assigned) return input.assigned;
  if (!input.ownerExists && input.listedInAdminEmails) return "admin";
  return null;
}
