/**
 * What the phone console shows for a role. The server decides the role and its permissions
 * (GET /api/admin/me) and checks them again on every request; this only hides what would be refused.
 * Pure module so it is unit tested.
 */

export type AdminSectionKey = "overview" | "users" | "flags" | "maintenance" | "announcements" | "audit";

export type AdminSection = { key: AdminSectionKey; title: string; detail: string; permission: string };

/** Phone scope (docs/ADMIN_CONSOLE_PROPOSAL.md 5.2). Everything else stays on the website console. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { key: "overview", title: "Overview", detail: "Service health and key counts", permission: "overview.read" },
  { key: "users", title: "Users", detail: "Search, suspend, sign out everywhere", permission: "users.read" },
  { key: "flags", title: "Feature flags", detail: "Turn features on or off", permission: "flags.read" },
  { key: "maintenance", title: "Maintenance", detail: "Take the app down for maintenance", permission: "maintenance.write" },
  { key: "announcements", title: "Announcements", detail: "Messages shown in the app and on the website", permission: "notifications.send" },
  { key: "audit", title: "Audit log", detail: "Every admin action, newest first", permission: "audit.read" },
];

export function can(permissions: readonly string[] | null | undefined, permission: string): boolean {
  return Boolean(permissions?.includes(permission));
}

export function sectionsFor(permissions: readonly string[] | null | undefined): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => can(permissions, s.permission));
}

export type FlagState = { enabled: boolean; rolloutPercent: number; targeting: Record<string, unknown>; startsAt: string | null; endsAt: string | null; description: string };
export type FlagItem = { key: string; label: string; description: string; default: boolean; state: FlagState | null; version: number; updatedAt: string | null };

/** Whether a flag is on as stored (or by its code default when nothing is stored). */
export function flagIsOn(f: FlagItem): boolean {
  return f.state ? f.state.enabled : f.default;
}

/**
 * The state to save when the kill switch is flipped: everything else stays as it is (rollout,
 * targeting, window), so the phone never edits more than on or off. A flag with no stored state starts
 * from its code default, as the website console does.
 */
export function killSwitchState(f: FlagItem, enabled: boolean): FlagState {
  const base: FlagState = f.state ?? { enabled: f.default, rolloutPercent: f.default ? 100 : 0, targeting: {}, startsAt: null, endsAt: null, description: "" };
  const rolloutPercent = enabled && base.rolloutPercent === 0 ? 100 : base.rolloutPercent;
  return { ...base, enabled, rolloutPercent };
}
