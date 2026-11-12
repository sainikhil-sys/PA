import { adminRoute } from "@/lib/admin/adapters";
import { updateAnnouncementOp } from "@/lib/admin/ops/announcements";

export const dynamic = "force-dynamic";

/** Body: the full announcement, as for create. */
export const PATCH = adminRoute(updateAnnouncementOp, "PATCH");
