import type { Permission } from "./permissions";

/**
 * Every console page, in menu order, with the permission it needs. The layout shows a tab only when
 * the role has the permission; each page checks it again with requireAdmin(permission).
 */
export const CONSOLE_PAGES: readonly { href: string; label: string; permission: Permission }[] = [
  { href: "/console", label: "Overview", permission: "overview.read" },
  { href: "/console/users", label: "Users", permission: "users.read" },
  { href: "/console/reports", label: "Reports", permission: "community.moderate" },
  { href: "/console/deletion", label: "Deletion requests", permission: "users.deletion_request" },
  { href: "/console/announcements", label: "Announcements", permission: "notifications.send" },
  { href: "/console/broadcast", label: "Broadcast", permission: "notifications.send" },
  { href: "/console/config", label: "Configuration", permission: "config.read" },
  { href: "/console/flags", label: "Feature flags", permission: "flags.read" },
  { href: "/console/releases", label: "Releases", permission: "releases.read" },
  { href: "/console/ai", label: "AI", permission: "ai.read" },
  { href: "/console/system", label: "Infrastructure", permission: "infra.read" },
  { href: "/console/analytics", label: "Analytics", permission: "analytics.read" },
  { href: "/console/security", label: "Security", permission: "audit.read" },
];
