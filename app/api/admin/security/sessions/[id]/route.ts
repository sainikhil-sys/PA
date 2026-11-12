import { adminRoute } from "@/lib/admin/adapters";
import { revokeAdminSessionOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** Owner only: end anyone's admin session. To end your own, use /api/admin/security/my-sessions/[id]. */
export const DELETE = adminRoute(revokeAdminSessionOp, "DELETE");
