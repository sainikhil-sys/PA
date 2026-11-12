import { adminRoute } from "@/lib/admin/adapters";
import { flagListOp, flagUpdateOp } from "@/lib/admin/ops/flags";

export const dynamic = "force-dynamic";

/** Every registered flag with its stored state (null = the code default applies). */
export const GET = adminRoute(flagListOp, "GET");

/** Body: { key, state: { enabled, rolloutPercent, targeting, startsAt, endsAt, description }, reason }. */
export const POST = adminRoute(flagUpdateOp, "POST");
