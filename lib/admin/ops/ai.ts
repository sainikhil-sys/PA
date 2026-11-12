import "server-only";
import { z } from "zod";
import { aiOverview } from "../ai-stats";
import { adminOp } from "../op";

/**
 * AI control (Phase I). Reads need ai.read. Changes to the AI keys go through the configuration op
 * aiConfigUpdateOp (ai.write) in ./config.ts, so they get a version, history and an audit row.
 */
export const aiOverviewOp = adminOp({
  action: "ai.overview",
  resourceType: "ai",
  permission: "ai.read",
  kind: "read",
  input: z.object({}),
  run: async () => aiOverview(),
});
