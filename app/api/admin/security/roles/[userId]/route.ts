import { adminRoute } from "@/lib/admin/adapters";
import { changeRoleOp, revokeRoleOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** Owner only. PATCH body: { role }. DELETE removes the role. Both end the person's admin sessions. */
export const PATCH = adminRoute(changeRoleOp, "PATCH");
export const DELETE = adminRoute(revokeRoleOp, "DELETE");
