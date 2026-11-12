import { adminRoute } from "@/lib/admin/adapters";
import { completeDeletionRequestOp } from "@/lib/admin/ops/deletion";

export const dynamic = "force-dynamic";

/**
 * Owner only. Body: { confirmEmail }. Destructive and needs a fresh unlock: the first call answers 409
 * with a summary and a token; repeat it with the token in the x-cowork-confirm header to delete.
 */
export const POST = adminRoute(completeDeletionRequestOp, "POST");
