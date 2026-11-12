import { adminRoute } from "@/lib/admin/adapters";
import { infraProbesOp } from "@/lib/admin/ops/infra";

export const dynamic = "force-dynamic";

/** Live probes: database, job queue, AI and run errors, mail, push. Fixed text and numbers only. */
export const GET = adminRoute(infraProbesOp, "GET");
