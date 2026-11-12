import { z } from "zod";
import { stepUp } from "@/lib/admin/mfa";
import { adminRequest } from "@/lib/admin/route-guard";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";

const body = z.object({ code: z.string().trim().min(6).max(20) });

/**
 * Unlocks admin work with an authenticator or recovery code. The app gets the admin token once in the
 * response (it keeps it in memory and sends it as X-Cowork-Admin); the web gets a cookie instead.
 * Setting up the authenticator happens on the web console only.
 */
export async function POST(req: Request) {
  const r = await adminRequest(req);
  if (r instanceof Response) return r;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson(400, "Enter the 6-digit code, or a recovery code.", { code: "invalid_input" });
  const s = await stepUp({ user: r.user, role: r.role, userSessionId: r.userSessionId, platform: r.bearer ? "android" : "web", cookie: !r.bearer, ipPrefix: r.ipPrefix, userAgent: r.userAgent, code: parsed.data.code });
  if (!s.ok) return errorJson(s.error.startsWith("Set up") ? 409 : 401, s.error, { code: s.error.startsWith("Set up") ? "mfa_not_enrolled" : "step_up_failed" });
  return Response.json({ expiresAt: s.expiresAt.toISOString(), ...(r.bearer ? { adminToken: s.token } : {}) }, { headers: { "cache-control": "no-store" } });
}
