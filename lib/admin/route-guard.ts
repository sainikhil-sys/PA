import "server-only";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth/session";
import type { User } from "@/lib/db/schema";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { errorJson, isSameOrigin } from "@/lib/security/request";
import { getAdminSession, type AdminSession } from "./admin-session";
import { ipPrefix } from "./core";
import { can, type AdminRole, type Permission } from "./permissions";
import { getAdminRole } from "./roles";

export const notFoundResponse = () => new Response("Not found", { status: 404 });

export type AdminRequest = { user: User; role: AdminRole; userSessionId: string; bearer: boolean; ipPrefix: string | null; userAgent: string | null };

/**
 * For the few /api/admin routes that can't be a JSON op (step-up, lock, me, file upload).
 * No session: 401. No role: the same 404 as a missing route. CSRF check for cookie writes.
 */
export async function adminRequest(req: Request): Promise<AdminRequest | Response> {
  const bearer = /^Bearer /.test(req.headers.get("authorization") ?? "");
  if (req.method !== "GET" && req.method !== "HEAD" && !bearer && !isSameOrigin(req)) return errorJson(403, "forbidden", { code: "forbidden" });
  const session = await getSession();
  if (!session) return errorJson(401, "unauthorized", { code: "unauthorized" });
  const role = await getAdminRole(session.user);
  if (!role) return notFoundResponse();
  const rl = await rateLimit("admin", session.user.id);
  if (!rl.success) return rateLimitResponse(rl);
  const h = await headers();
  return { user: session.user, role, userSessionId: session.sessionId, bearer, ipPrefix: ipPrefix(h.get("x-forwarded-for")?.split(",")[0]?.trim()), userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

/** adminRequest plus a valid admin session and the permission. */
export async function adminRequestWith(req: Request, permission: Permission): Promise<(AdminRequest & { adminSession: AdminSession }) | Response> {
  const r = await adminRequest(req);
  if (r instanceof Response) return r;
  const adminSession = await getAdminSession();
  if (!adminSession) return errorJson(401, "Your admin session ended. Unlock the console to continue.", { code: "step_up_required" });
  if (!can(r.role, permission)) return errorJson(403, "Your role can't do this.", { code: "forbidden" });
  return { ...r, adminSession };
}
