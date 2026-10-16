import { getOwnerForSystem } from "@/lib/auth/session";
import { processJobs } from "@/lib/jobs/handlers";
import { scheduleDueWork } from "@/lib/jobs/scheduler";
import { errMessage, log } from "@/lib/log";
import { unauthorizedCron, verifyCron } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Main dispatcher (every 5 minutes). Enqueues due work (idempotent dedupe keys,
 * run keys) and drains the job queue in small batches within the time budget.
 */
export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedCron();
  const user = await getOwnerForSystem();
  if (!user) return Response.json({ skipped: "no owner yet" });
  let scheduled: Record<string, unknown> = {};
  try {
    scheduled = await scheduleDueWork(user);
  } catch (err) {
    log.error("dispatch.schedule_failed", { error: errMessage(err) });
  }
  const result = await processJobs({ budgetMs: 240_000, batchSize: 4 });
  return Response.json({ scheduled, ...result });
}
