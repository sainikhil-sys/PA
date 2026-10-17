import { processJobs } from "@/lib/jobs/handlers";
import { forEachUser } from "@/lib/jobs/each-user";
import { scheduleInboxSync } from "@/lib/jobs/scheduler";
import { unauthorizedCron, verifyCron } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Enqueue an inbox sync for every user with Google connected, then drain sync/classification jobs. */
export async function GET(req: Request) {
  if (!verifyCron(req)) return unauthorizedCron();
  const scheduled = await forEachUser("sync_email", scheduleInboxSync);
  const result = await processJobs({ budgetMs: 240_000, types: ["sync_inbox", "classify_emails"] });
  return Response.json({ scheduled, ...result });
}
