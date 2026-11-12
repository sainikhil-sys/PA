import { adminRoute } from "@/lib/admin/adapters";
import { auditChainOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** Recomputes the audit hash chain and reports the first broken entry, if any. */
export const GET = adminRoute(auditChainOp, "GET");
