import { adminRoute } from "@/lib/admin/adapters";
import { searchUsersOp } from "@/lib/admin/ops/users";

export const dynamic = "force-dynamic";

/** Query: q, status (all, active, suspended), restricted (any or a feature), platform, appVersion, page. */
export const GET = adminRoute(searchUsersOp, "GET");
