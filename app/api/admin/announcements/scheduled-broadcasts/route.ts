import { adminRoute } from "@/lib/admin/adapters";
import { listScheduledBroadcastsOp, scheduleBroadcastOp } from "@/lib/admin/ops/announcements";

export const dynamic = "force-dynamic";

export const GET = adminRoute(listScheduledBroadcastsOp, "GET");
/** Body: the same as an immediate broadcast, without confirm, plus sendAt. */
export const POST = adminRoute(scheduleBroadcastOp, "POST");
