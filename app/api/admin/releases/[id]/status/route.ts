import { adminRoute } from "@/lib/admin/adapters";
import { releaseStatusOp } from "@/lib/admin/ops/releases";

export const dynamic = "force-dynamic";

/** Body: { status: "draft" | "testing" | "live" | "halted" | "retired" }. */
export const POST = adminRoute(releaseStatusOp, "POST");
