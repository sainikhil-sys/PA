import { getOwnerForSystem } from "@/lib/auth/session";
import { processJobs } from "@/lib/jobs/handlers";
import { scheduleInboxSync } from "@/lib/jobs/scheduler";
import { unauthorizedCron, verifyCron } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Enqueue an inbox sync, then drain sync/classification jobs in small batches. */
export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedCron();
  const user = await getOwnerForSystem();
  if (!user) return Response.json({ skipped: "no owner yet" });
  const scheduled = await scheduleInboxSync(user);
  const result = await processJobs({ budgetMs: 240_000, types: ["sync_inbox", "classify_emails"] });
  return Response.json({ scheduled, ...result });
}
