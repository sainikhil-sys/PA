import { adminRoute } from "@/lib/admin/adapters";
import { addRestrictionOp } from "@/lib/admin/ops/users";

export const dynamic = "force-dynamic";

/** Body: { feature, reason, expiresAt? }. Replaces an active restriction on the same feature. */
export const POST = adminRoute(addRestrictionOp, "POST");
