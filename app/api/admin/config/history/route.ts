import { adminRoute } from "@/lib/admin/adapters";
import { configHistoryOp } from "@/lib/admin/ops/config";

export const dynamic = "force-dynamic";

/** ?key=... Versions of one key, newest first. */
export const GET = adminRoute(configHistoryOp, "GET");
