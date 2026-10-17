import { processJobs } from "@/lib/jobs/handlers";
import { forEachUser } from "@/lib/jobs/each-user";
import { scheduleBriefing } from "@/lib/jobs/scheduler";
import { unauthorizedCron, verifyCron } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Converts to each user's timezone and generates today's briefing once their
 * configured local time has passed. Idempotent (dedupe key per user and date).
 */
export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedCron();
  const scheduled = await forEachUser("briefing", scheduleBriefing);
  const result = await processJobs({ budgetMs: 240_000, types: ["daily_briefing"] });
  return Response.json({ scheduled, result });
}
