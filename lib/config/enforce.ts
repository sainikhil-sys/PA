import "server-only";
import { getAdminRole } from "@/lib/admin/roles";
import type { User } from "@/lib/db/schema";
import { DEFAULT_MAINTENANCE_MESSAGE, effectiveMinBuild, retryAfterSeconds } from "./registry";
import { getMaintenance, getUpdatePolicy } from "./store";
import { readClientHeaders } from "./version";

/**
 * Server-side enforcement of maintenance mode and the minimum app build (proposal 4.3). The
 * configuration response only shapes the interface; these checks are the real control.
 */

export type MaintenanceBlock = { message: string; endsAt: string | null; retryAfter: number };

/** Null when the person may continue: maintenance is off, or they hold an admin role. */
export async function maintenanceBlock(user: Pick<User, "id" | "disabledAt">): Promise<MaintenanceBlock | null> {
  const m = await getMaintenance();
  if (!m.active) return null;
  if (await getAdminRole(user)) return null;
  return { message: m.message ?? DEFAULT_MAINTENANCE_MESSAGE, endsAt: m.endsAt, retryAfter: retryAfterSeconds(m.endsAt) };
}

export function maintenanceResponse(b: MaintenanceBlock): Response {
  return Response.json(
    { error: b.message, code: "maintenance", message: b.message, endsAt: b.endsAt },
    { status: 503, headers: { "retry-after": String(b.retryAfter), "cache-control": "no-store" } },
  );
}

/**
 * Routes an outdated app may still use, so nobody is locked out of their own data: configuration,
 * sign-out, data export and account deletion. Also exempt from maintenance: sign-out.
 */
export function isUpdateExempt(pathname: string, method: string): boolean {
  if (pathname === "/api/config" || pathname.startsWith("/api/config/")) return true;
  if (pathname === "/api/mobile/auth/sign-out") return true;
  if (pathname === "/api/export") return true;
  if (pathname === "/api/mobile/me" && method === "DELETE") return true;
  return false;
}

export function isMaintenanceExempt(pathname: string): boolean {
  return pathname === "/api/mobile/auth/sign-out" || pathname === "/api/config" || pathname.startsWith("/api/config/");
}

/**
 * 426 for app (Bearer) requests from a build below the minimum. A missing build header counts as
 * build 0. Cookie (website) requests are never affected.
 */
export async function updateRequiredResponse(req: Request): Promise<Response | null> {
  if (!/^Bearer /.test(req.headers.get("authorization") ?? "")) return null;
  const url = new URL(req.url);
  if (isUpdateExempt(url.pathname, req.method)) return null;
  const policy = await getUpdatePolicy();
  const min = effectiveMinBuild(policy);
  if (min <= 0) return null;
  const build = readClientHeaders(req.headers).build ?? 0;
  if (build >= min) return null;
  const message = policy.message ?? "This version of Cowork is no longer supported. Update the app to keep going.";
  return Response.json({ error: message, code: "update_required", message, storeUrl: policy.storeUrl }, { status: 426, headers: { "cache-control": "no-store" } });
}
