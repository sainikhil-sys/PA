import { adminRoute } from "@/lib/admin/adapters";
import { aiOverviewOp } from "@/lib/admin/ops/ai";

export const dynamic = "force-dynamic";

/** Switches, daily limit, usage per day, error rates per provider, cost estimate, providers and which keys are set (never values). */
export const GET = adminRoute(aiOverviewOp, "GET");
