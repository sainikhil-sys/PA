import { adminRoute } from "@/lib/admin/adapters";
import { listAdminSessionsOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** Every admin session that can still be used. */
export const GET = adminRoute(listAdminSessionsOp, "GET");
