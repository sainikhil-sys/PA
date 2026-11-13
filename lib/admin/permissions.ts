/**
 * Admin roles and what each may do. Defined in code, never in the database, so no data change can
 * grant a permission the code does not define. Role ASSIGNMENTS live in admin_role_assignments.
 * Pure module (no server-only imports) so it is unit tested.
 */
export const ADMIN_ROLES = ["owner", "admin", "moderator", "support", "analyst"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const PERMISSIONS = [
  "overview.read",
  "users.read",
  "users.suspend",
  "users.sessions.revoke",
  "users.delete",
  /** Record a deletion request (support); only the owner completes it (users.delete). */
  "users.deletion_request",
  "config.read",
  "config.write",
  "config.rollback",
  "ai.read",
  "ai.write",
  "connect.read",
  "connect.write",
  "flags.read",
  "flags.write",
  "releases.read",
  "releases.write",
  "releases.mandatory",
  "appearance.write",
  "notifications.send",
  "community.moderate",
  /** See which account wrote an anonymous post or comment (audited each time). */
  "anonymous.reveal",
  "security.read",
  "security.policy",
  "roles.manage",
  "infra.read",
  "infra.write",
  "analytics.read",
  "audit.read",
  "maintenance.write",
  "secrets.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Critical controls only the single owner holds, whatever other roles exist. */
export const OWNER_ONLY: ReadonlySet<Permission> = new Set<Permission>([
  "roles.manage",
  "security.policy",
  "releases.mandatory",
  "maintenance.write",
  "users.delete",
  "config.rollback",
  "secrets.read",
]);

const ALL = new Set<Permission>(PERMISSIONS);
const ADMIN = new Set<Permission>(PERMISSIONS.filter((p) => !OWNER_ONLY.has(p)));

export const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<Permission>> = {
  owner: ALL,
  admin: ADMIN,
  moderator: new Set<Permission>(["overview.read", "users.read", "community.moderate"]),
  support: new Set<Permission>(["overview.read", "users.read", "users.sessions.revoke", "users.deletion_request"]),
  analyst: new Set<Permission>(["overview.read", "analytics.read", "infra.read", "ai.read", "connect.read"]),
};

export function can(role: AdminRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  if (OWNER_ONLY.has(permission) && role !== "owner") return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}
