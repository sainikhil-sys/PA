import { adminRoute } from "@/lib/admin/adapters";
import { verifyDeletionRequestOp } from "@/lib/admin/ops/deletion";

export const dynamic = "force-dynamic";

/** Body: { note? }. */
export const POST = adminRoute(verifyDeletionRequestOp, "POST");
