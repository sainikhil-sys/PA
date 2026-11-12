import { adminRoute } from "@/lib/admin/adapters";
import { auditEntryOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** One audit entry with its before and after values. */
export const GET = adminRoute(auditEntryOp, "GET");
