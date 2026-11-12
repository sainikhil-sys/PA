import { adminRoute } from "@/lib/admin/adapters";
import { retryDeadJobOp } from "@/lib/admin/ops/legacy";

export const dynamic = "force-dynamic";

export const POST = adminRoute(retryDeadJobOp, "POST");
