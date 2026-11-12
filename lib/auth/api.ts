import "server-only";
import { isMaintenanceExempt, maintenanceBlock, maintenanceResponse, updateRequiredResponse } from "@/lib/config/enforce";
import type { User } from "@/lib/db/schema";
import { maintenanceOn, maintenanceResponse as killSwitchResponse } from "@/lib/maintenance";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { errorJson, isSameOrigin } from "@/lib/security/request";
import { getOwner } from "./session";

/**
 * Guard for route handlers (website cookie or the app's Bearer token): owner session, rate limit,
 * same-origin check on state-changing methods (CSRF), maintenance mode (503 except for admins) and the
 * minimum app build (426, app requests only).
 */
export async function apiGuard(req: Request): Promise<{ user: User } | { response: Response }> {
  // MAINTENANCE_MODE=on is the hard kill switch (everyone, admins too); the console's maintenance mode is below.
  if (maintenanceOn()) return { response: killSwitchResponse() };
  if (req.method !== "GET" && req.method !== "HEAD" && !isSameOrigin(req)) return { response: errorJson(403, "forbidden") };
  const user = await getOwner();
  if (!user) return { response: errorJson(401, "unauthorized") };
  const rl = await rateLimit("api", `user:${user.id}`);
  if (!rl.success) return { response: rateLimitResponse(rl) };
  if (!isMaintenanceExempt(new URL(req.url).pathname)) {
    const blocked = await maintenanceBlock(user);
    if (blocked) return { response: maintenanceResponse(blocked) };
  }
  const outdated = await updateRequiredResponse(req);
  if (outdated) return { response: outdated };
  return { user };
}
