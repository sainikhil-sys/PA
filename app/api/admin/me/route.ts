import { getAdminSession } from "@/lib/admin/admin-session";
import { getMfaStatus } from "@/lib/admin/mfa";
import { PERMISSIONS, can } from "@/lib/admin/permissions";
import { adminRequest } from "@/lib/admin/route-guard";

export const dynamic = "force-dynamic";

/**
 * The app asks this to decide whether to show "Admin console" on Profile. Role holders get their role,
 * permissions and lock state; everyone else gets the same 404 as a missing route.
 */
export async function GET(req: Request) {
  const r = await adminRequest(req);
  if (r instanceof Response) return r;
  const [mfa, adminSession] = await Promise.all([getMfaStatus(r.user.id), getAdminSession()]);
  return Response.json(
    {
      role: r.role,
      permissions: PERMISSIONS.filter((p) => can(r.role, p)),
      mfaEnrolled: mfa.enrolled,
      lockedUntil: mfa.lockedUntil?.toISOString() ?? null,
      unlocked: Boolean(adminSession),
      adminSessionExpiresAt: adminSession?.expiresAt.toISOString() ?? null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
