import { adminRoute } from "@/lib/admin/adapters";
import { archiveAnnouncementOp } from "@/lib/admin/ops/announcements";

export const dynamic = "force-dynamic";

export const POST = adminRoute(archiveAnnouncementOp, "POST");
