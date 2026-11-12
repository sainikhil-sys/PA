import { adminRoute } from "@/lib/admin/adapters";
import { releaseCreateOp, releasesOverviewOp } from "@/lib/admin/ops/releases";

export const dynamic = "force-dynamic";

/** Update policy, recorded releases and version adoption. */
export const GET = adminRoute(releasesOverviewOp, "GET");

/** Records a store build or an OTA update as a draft. */
export const POST = adminRoute(releaseCreateOp, "POST");
