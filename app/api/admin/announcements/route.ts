import { adminRoute } from "@/lib/admin/adapters";
import { createAnnouncementOp, listAnnouncementsOp } from "@/lib/admin/ops/announcements";

export const dynamic = "force-dynamic";

export const GET = adminRoute(listAnnouncementsOp, "GET");
/** Body: { title, body, severity, placement, href?, dismissible, startsAt?, endsAt?, targeting }. */
export const POST = adminRoute(createAnnouncementOp, "POST");
