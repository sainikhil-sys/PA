import { adminRoute } from "@/lib/admin/adapters";
import { policyUpdateOp } from "@/lib/admin/ops/releases";

export const dynamic = "force-dynamic";

/**
 * Body: { policy, reason }. Edits that don't raise the required build. Raising it (mandatory update)
 * is owner-only and done on the web console.
 */
export const POST = adminRoute(policyUpdateOp, "POST");
