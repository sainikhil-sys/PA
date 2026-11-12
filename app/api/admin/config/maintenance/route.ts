import { adminRoute } from "@/lib/admin/adapters";
import { maintenanceSetOp } from "@/lib/admin/ops/config";

export const dynamic = "force-dynamic";

/**
 * Body: { active, message, endsAt, pauseJobs, reason }. Owner only. The first call answers 409 with a
 * summary and a token; send it back in the X-Cowork-Confirm header to commit.
 */
export const POST = adminRoute(maintenanceSetOp, "POST");
