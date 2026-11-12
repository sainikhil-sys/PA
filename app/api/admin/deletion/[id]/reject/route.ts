import { adminRoute } from "@/lib/admin/adapters";
import { rejectDeletionRequestOp } from "@/lib/admin/ops/deletion";

export const dynamic = "force-dynamic";

/** Body: { note }. */
export const POST = adminRoute(rejectDeletionRequestOp, "POST");
