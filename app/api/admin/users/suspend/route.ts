import { adminRoute } from "@/lib/admin/adapters";
import { suspendUsersOp } from "@/lib/admin/ops/users";

export const dynamic = "force-dynamic";

/**
 * Body: { userIds, reason }. Destructive: the first call answers 409 with a summary and a token; send
 * the same body again with the token in the x-cowork-confirm header to commit.
 */
export const POST = adminRoute(suspendUsersOp, "POST");
