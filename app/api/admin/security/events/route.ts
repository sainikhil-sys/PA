import { adminRoute } from "@/lib/admin/adapters";
import { securityEventsOp } from "@/lib/admin/ops/security";

export const dynamic = "force-dynamic";

/** Wrong step-up codes and lockouts in the last 30 days, and current lockouts. */
export const GET = adminRoute(securityEventsOp, "GET");
