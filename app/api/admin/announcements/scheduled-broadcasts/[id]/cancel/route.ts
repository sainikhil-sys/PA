import { adminRoute } from "@/lib/admin/adapters";
import { cancelScheduledBroadcastOp } from "@/lib/admin/ops/announcements";

export const dynamic = "force-dynamic";

export const POST = adminRoute(cancelScheduledBroadcastOp, "POST");
