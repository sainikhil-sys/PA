import "server-only";
import type { User } from "@/lib/db/schema";
import { maintenanceOn, maintenanceResponse } from "@/lib/maintenance";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { errorJson, isSameOrigin } from "@/lib/security/request";
import { getOwner } from "./session";

/**
 * Guard for cookie-authenticated route handlers: owner session, rate limit,
 * and same-origin check on state-changing methods (CSRF).
 */
export async function apiGuard(req: Request): Promise<{ user: User } | { response: Response }> {
  if (maintenanceOn()) return { response: maintenanceResponse() };
  if (req.method !== "GET" && req.method !== "HEAD" && !isSameOrigin(req)) return { response: errorJson(403, "forbidden") };
  const user = await getOwner();
  if (!user) return { response: errorJson(401, "unauthorized") };
  const rl = await rateLimit("api", `user:${user.id}`);
  if (!rl.success) return { response: rateLimitResponse(rl) };
  return { user };
}
