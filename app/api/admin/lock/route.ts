import { endCurrentAdminSession, getAdminSession } from "@/lib/admin/admin-session";
import { writeAudit } from "@/lib/admin/audit";
import { emailHash } from "@/lib/admin/core";
import { adminRequest } from "@/lib/admin/route-guard";

export const dynamic = "force-dynamic";

/** Ends this device's admin session. */
export async function POST(req: Request) {
  const r = await adminRequest(req);
  if (r instanceof Response) return r;
  const s = await getAdminSession();
  await endCurrentAdminSession();
  if (s) {
    await writeAudit({ actorUserId: r.user.id, actorEmailHash: emailHash(r.user.email), actorRole: r.role, adminSessionId: s.id, action: "admin_session.end", resourceType: "admin_session", resourceId: s.id, outcome: "success", ipPrefix: r.ipPrefix, userAgent: r.userAgent });
  }
  return Response.json({ ok: true });
}
