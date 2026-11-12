import { getMaintenance, invalidateConfigCache } from "@/lib/config/store";
import { processJobs } from "@/lib/jobs/handlers";
import { forEachUser } from "@/lib/jobs/each-user";
import { scheduleDueWork } from "@/lib/jobs/scheduler";
import { pruneAllPhoneEvents } from "@/lib/phone-server";
import { unauthorizedCron, verifyCron } from "@/lib/security/cron";
import { purgeExpiredMomentMedia } from "@/lib/moments/service";
import { pruneRateLimits } from "@/lib/security/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Main dispatcher. Enqueues due work for every user (idempotent dedupe keys,
 * run keys) and drains the job queue in small batches within the time budget.
 */
export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedCron();
  // Maintenance can pause background work (console: maintenance.pauseJobs). Read fresh, not from the cache.
  invalidateConfigCache();
  if ((await getMaintenance()).pauseJobs) return Response.json({ paused: true, scheduled: 0 });
  const scheduled = await forEachUser("dispatch", scheduleDueWork);
  // Phone notifications are kept 3 days (the privacy policy promises it), even for phones that stopped sending.
  await pruneAllPhoneEvents().catch(() => {});
  await pruneRateLimits().catch(() => {});
  await purgeExpiredMomentMedia().catch(() => {});
  const result = await processJobs({ budgetMs: 240_000, batchSize: 4 });
  return Response.json({ scheduled, ...result });
}
