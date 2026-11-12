import { adminRoute } from "@/lib/admin/adapters";
import { resetMfaOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** Owner only, fresh unlock: reset another admin's two-step verification and end their admin sessions. */
export const DELETE = adminRoute(resetMfaOp, "DELETE");
