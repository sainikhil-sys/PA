import { getOwnerForSystem } from "@/lib/auth/session";
import { processJobs } from "@/lib/jobs/handlers";
import { scheduleBriefing } from "@/lib/jobs/scheduler";
import { unauthorizedCron, verifyCron } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Runs hourly (UTC). Converts to the owner's timezone and generates today's
 * briefing once the configured local time has passed. Idempotent.
 */
export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedCron();
  const user = await getOwnerForSystem();
  if (!user) return Response.json({ skipped: "no owner yet" });
  const scheduled = await scheduleBriefing(user);
  const result = scheduled ? await processJobs({ budgetMs: 90_000, types: ["daily_briefing"] }) : null;
  return Response.json({ scheduled, result });
}
