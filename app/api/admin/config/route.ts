import { adminRoute } from "@/lib/admin/adapters";
import { configListOp, configUpdateOp } from "@/lib/admin/ops/config";

export const dynamic = "force-dynamic";

/** Every configuration key with its current value. */
export const GET = adminRoute(configListOp, "GET");

/** Body: { key, value, reason }. Keys that need config.write; appearance keys use /appearance. */
export const POST = adminRoute(configUpdateOp, "POST");
