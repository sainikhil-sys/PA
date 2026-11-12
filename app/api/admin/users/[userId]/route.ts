import { adminRoute } from "@/lib/admin/adapters";
import { userDetailOp } from "@/lib/admin/ops/users";

export const dynamic = "force-dynamic";

/** Account metadata, live sessions, restrictions, usage counts and audit entries. Never content. */
export const GET = adminRoute(userDetailOp, "GET");
