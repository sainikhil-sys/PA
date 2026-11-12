import { adminRoute } from "@/lib/admin/adapters";
import { flagHistoryOp } from "@/lib/admin/ops/flags";

export const dynamic = "force-dynamic";

/** ?key=... Versions of one flag, newest first. */
export const GET = adminRoute(flagHistoryOp, "GET");
