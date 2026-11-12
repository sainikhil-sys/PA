import { adminRoute } from "@/lib/admin/adapters";
import { appearanceUpdateOp } from "@/lib/admin/ops/config";

export const dynamic = "force-dynamic";

/** Body: { key, value, reason } for appearance keys (appearance.write). */
export const POST = adminRoute(appearanceUpdateOp, "POST");
