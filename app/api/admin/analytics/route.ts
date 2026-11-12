import { adminRoute } from "@/lib/admin/adapters";
import { analyticsSummaryOp } from "@/lib/admin/ops/analytics";

export const dynamic = "force-dynamic";

/** Product analytics, counts only (analytics.read). */
export const GET = adminRoute(analyticsSummaryOp, "GET");
