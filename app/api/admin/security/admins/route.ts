import { adminRoute } from "@/lib/admin/adapters";
import { listRoleHoldersOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** Everyone holding an admin role, with two-step status and last admin session. */
export const GET = adminRoute(listRoleHoldersOp, "GET");
