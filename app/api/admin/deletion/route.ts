import { adminRoute } from "@/lib/admin/adapters";
import { listDeletionRequestsOp, recordDeletionRequestOp } from "@/lib/admin/ops/deletion";

export const dynamic = "force-dynamic";

/** The deletion request queue, open requests first by due date. */
export const GET = adminRoute(listDeletionRequestsOp, "GET");
/** Body: { email, source, receivedAt?, note? }. Due 30 days after it was received. */
export const POST = adminRoute(recordDeletionRequestOp, "POST");
