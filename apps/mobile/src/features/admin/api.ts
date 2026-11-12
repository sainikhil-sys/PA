import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import type { FlagItem } from "./permissions";
import { adminHeaders, useAdminToken } from "./token-store";

/**
 * Admin requests from the phone. Every call carries the in-memory admin token. A `step_up_required`
 * answer ends the admin session here and sends the person back to the code screen; it never signs
 * them out of Cowork.
 */

export const CONFIRM_HEADER = "x-cowork-confirm";

export type AdminMe = {
  role: string;
  permissions: string[];
  mfaEnrolled: boolean;
  lockedUntil: string | null;
  unlocked: boolean;
  adminSessionExpiresAt: string | null;
};

export type ProbeStatus = "working" | "degraded" | "unavailable";
export type Probe = { id: string; label: string; status: ProbeStatus; value: string; detail: string; ms: number; measuredAt: string };
export type AnalyticsSummary = {
  active: { day: number; week: number; month: number };
  signups: { week: number; month: number; total: number };
  conversations: { week: number; month: number; messagesWeek: number };
};
export type UserRow = { id: string; email: string; name: string | null; createdAt: string; disabledAt: string | null; lastSeen: string | null; platforms: string[]; appVersion: string | null; restrictions: number };
export type UserPage = { page: number; pageSize: number; total: number; pages: number; rows: UserRow[] };
export type UserDetail = {
  user: { id: string; email: string; name: string | null; createdAt: string; onboardedAt: string | null; disabledAt: string | null; adminRole: string | null };
  sessions: { id: string; device: string; platform: string | null; appVersion: string | null; network: string | null; lastSeenAt: string; createdAt: string }[];
  restrictions: { id: string; feature: string; reason: string; expiresAt: string | null; createdAt: string; liftedAt: string | null; active: boolean }[];
  usage: Record<string, number>;
};
export type AdminAnnouncement = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  placement: "banner" | "home_card";
  dismissible: boolean;
  status: "scheduled" | "live" | "ended" | "archived";
  startsAt: string;
  endsAt: string | null;
  dismissals: number;
};
export type AuditRow = { seq: number; createdAt: string; actorRole: string | null; actorEmail: string | null; action: string; resourceType: string; resourceId: string | null; outcome: string; reason: string | null };
export type AuditPage = { rows: AuditRow[]; page: number; hasMore: boolean };
export type ConfigEntry = { key: string; value: unknown };

/** The confirmation a destructive operation asks for before it runs (409 confirm_required). */
export type ConfirmRequest = { summary: string; token: string };
export function confirmFrom(err: unknown): ConfirmRequest | null {
  if (!(err instanceof ApiError) || err.code !== "confirm_required") return null;
  const c = (err.data as { confirm?: { summary?: unknown; token?: unknown } } | null)?.confirm;
  return c && typeof c.summary === "string" && typeof c.token === "string" ? { summary: c.summary, token: c.token } : null;
}

/** Ends the admin session on this phone and forgets everything the console loaded. */
export function endAdminSession(notice: string | null = null) {
  useAdminToken.getState().end(notice);
  queryClient.removeQueries({ queryKey: ["admin"] });
}

/** A raw admin call (me, step-up, lock answer without the `data` wrapper). */
export async function adminRaw<T>(path: string, init: { method?: string; body?: unknown; confirmToken?: string } = {}): Promise<T> {
  const headers = { ...adminHeaders(useAdminToken.getState().token), ...(init.confirmToken ? { [CONFIRM_HEADER]: init.confirmToken } : {}) };
  try {
    return await api<T>(path, { method: init.method, body: init.body, headers });
  } catch (err) {
    if (err instanceof ApiError && err.code === "step_up_required") endAdminSession(err.message);
    throw err;
  }
}

/** An admin operation: /api/admin/* answers `{ data }`. */
export async function adminOp<T>(path: string, init: { method?: string; body?: unknown; confirmToken?: string } = {}): Promise<T> {
  return (await adminRaw<{ data: T }>(path, init)).data;
}

export const adminKeys = {
  me: ["adminMe"] as const,
  probes: ["admin", "probes"] as const,
  analytics: ["admin", "analytics"] as const,
  users: (q: string, page: number) => ["admin", "users", q, page] as const,
  user: (id: string) => ["admin", "user", id] as const,
  flags: ["admin", "flags"] as const,
  config: ["admin", "config"] as const,
  announcements: ["admin", "announcements"] as const,
  audit: (page: number) => ["admin", "audit", page] as const,
};

const noRetry = { retry: false } as const;

/** Profile shows "Admin console" only when this succeeds; ordinary accounts get a 404. */
export const useAdminMe = (enabled = true) => useQuery({ queryKey: adminKeys.me, enabled, staleTime: 60_000, ...noRetry, queryFn: () => adminRaw<AdminMe>("/api/admin/me") });

function useUnlocked() {
  return useAdminToken((s) => Boolean(s.token));
}

export const useProbes = (enabled: boolean) => {
  const on = useUnlocked();
  return useQuery({ queryKey: adminKeys.probes, enabled: on && enabled, ...noRetry, queryFn: () => adminOp<{ probes: Probe[] }>("/api/admin/health").then((r) => r.probes) });
};
export const useAnalytics = (enabled: boolean) => {
  const on = useUnlocked();
  return useQuery({ queryKey: adminKeys.analytics, enabled: on && enabled, ...noRetry, queryFn: () => adminOp<AnalyticsSummary>("/api/admin/analytics") });
};
export const useUserSearch = (q: string, page: number) => {
  const on = useUnlocked();
  return useQuery({
    queryKey: adminKeys.users(q, page),
    enabled: on,
    placeholderData: keepPreviousData,
    ...noRetry,
    queryFn: () => adminOp<UserPage>(`/api/admin/users?${new URLSearchParams({ q, page: String(page) }).toString()}`),
  });
};
export const useUserDetail = (id: string) => {
  const on = useUnlocked();
  return useQuery({ queryKey: adminKeys.user(id), enabled: on && Boolean(id), ...noRetry, queryFn: () => adminOp<UserDetail>(`/api/admin/users/${encodeURIComponent(id)}`) });
};
export const useFlags = () => {
  const on = useUnlocked();
  return useQuery({ queryKey: adminKeys.flags, enabled: on, ...noRetry, queryFn: () => adminOp<FlagItem[]>("/api/admin/flags") });
};
export const useAdminConfig = (enabled: boolean) => {
  const on = useUnlocked();
  return useQuery({ queryKey: adminKeys.config, enabled: on && enabled, ...noRetry, queryFn: () => adminOp<ConfigEntry[]>("/api/admin/config") });
};
export const useAnnouncements = () => {
  const on = useUnlocked();
  return useQuery({ queryKey: adminKeys.announcements, enabled: on, ...noRetry, queryFn: () => adminOp<AdminAnnouncement[]>("/api/admin/announcements") });
};
export const useAudit = (page: number) => {
  const on = useUnlocked();
  return useQuery({ queryKey: adminKeys.audit(page), enabled: on, placeholderData: keepPreviousData, ...noRetry, queryFn: () => adminOp<AuditPage>(`/api/admin/audit?page=${page}`) });
};
