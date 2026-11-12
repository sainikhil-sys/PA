import { adminRoute } from "@/lib/admin/adapters";
import { liftRestrictionOp } from "@/lib/admin/ops/users";

export const dynamic = "force-dynamic";

/** Lifts the restriction now. Body: { reason? }. */
export const DELETE = adminRoute(liftRestrictionOp, "DELETE");
