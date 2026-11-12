import { adminRoute } from "@/lib/admin/adapters";
import { revokeOwnAdminSessionOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** Any role holder: end one of your own admin sessions. */
export const DELETE = adminRoute(revokeOwnAdminSessionOp, "DELETE");
