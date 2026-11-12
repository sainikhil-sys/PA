import { adminRoute } from "@/lib/admin/adapters";
import { grantRoleOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** Owner only. Body: { email, role, note? }. Destructive: the first call returns a confirmation token. */
export const POST = adminRoute(grantRoleOp, "POST");
