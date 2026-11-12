import "server-only";
import { z } from "zod";
import { analyticsSummary } from "../analytics";
import { adminOp } from "../op";

/** Product analytics: counts only, never email addresses or content (analysts hold this permission). */
export const analyticsSummaryOp = adminOp({
  action: "analytics.summary",
  resourceType: "analytics",
  permission: "analytics.read",
  kind: "read",
  input: z.object({}),
  run: async () => analyticsSummary(),
});
