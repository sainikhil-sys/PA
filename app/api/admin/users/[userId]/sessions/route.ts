import { adminRoute } from "@/lib/admin/adapters";
import { revokeUserSessionsOp } from "@/lib/admin/ops/users";

export const dynamic = "force-dynamic";

/** Signs the person out on every device (and ends any admin session). Body: { reason? }. */
export const DELETE = adminRoute(revokeUserSessionsOp, "DELETE");
