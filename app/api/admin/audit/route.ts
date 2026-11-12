import { adminRoute } from "@/lib/admin/adapters";
import { auditQueryOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** Query: actor, action, resourceType, resourceId, outcome, from, to (YYYY-MM-DD), page. Typed filters only. */
export const GET = adminRoute(auditQueryOp, "GET");
