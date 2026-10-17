import { processJobs } from "@/lib/jobs/handlers";
import { forEachUser } from "@/lib/jobs/each-user";
import { scheduleDueWork } from "@/lib/jobs/scheduler";
import { unauthorizedCron, verifyCron } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Main dispatcher. Enqueues due work for every user (idempotent dedupe keys,
 * run keys) and drains the job queue in small batches within the time budget.
 */
export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedCron();
  const scheduled = await forEachUser("dispatch", scheduleDueWork);
  const result = await processJobs({ budgetMs: 240_000, batchSize: 4 });
  return Response.json({ scheduled, ...result });
}
