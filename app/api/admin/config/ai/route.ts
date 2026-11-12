import { adminRoute } from "@/lib/admin/adapters";
import { aiConfigUpdateOp } from "@/lib/admin/ops/config";

export const dynamic = "force-dynamic";

/** Body: { key, value, reason } for AI keys: capability switches, daily limit, price table (ai.write). */
export const POST = adminRoute(aiConfigUpdateOp, "POST");
