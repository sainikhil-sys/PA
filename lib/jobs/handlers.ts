import "server-only";
import { processBroadcast } from "@/lib/admin/broadcast";
import { runAgentTask } from "@/lib/agents/run-task";
import { recheckContent } from "@/lib/feed/posts";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { classifyEmail } from "@/lib/agents/emailAgent";
import { generateDailyBriefing } from "@/lib/agents/briefingAgent";
import { emitEvent } from "@/lib/automations/events";
import { runAutomation } from "@/lib/automations/engine";
import { suggestDailyIdeas } from "@/lib/content/ideas";
import { sendBriefingDigest } from "@/lib/digest";
import { db, schema } from "@/lib/db";
import type { Job } from "@/lib/db/schema";
import { logActivity } from "@/lib/db/queries/activity";
import { unclassifiedEmails } from "@/lib/db/queries/emails";
import { notify } from "@/lib/db/queries/notifications";
import { getIntegration, getSettings } from "@/lib/db/queries/settings";
import { dueReminders } from "@/lib/db/queries/tasks";
import { getMessageMeta, listRecentMessageIds } from "@/lib/integrations/gmail";
import { syncKnowledgeSource } from "@/lib/knowledge/sync";
import { errMessage, log } from "@/lib/log";
import { refreshNews } from "@/lib/news/fetch";
import { claimBatch, enqueue, markFailed, markSucceeded, recoverStaleJobs, type JobType } from "./queue";

/** Emails processed per job run; small enough that no function times out. */
export const EMAIL_BATCH_SIZE = 15;
const FIRST_SYNC_LOOKBACK_MS = 3 * 86_400_000;
const SYNC_OVERLAP_MS = 60 * 60_000;
const MAX_NEW_PER_SYNC = 40;

async function ownerOf(job: Job) {
  const user = await db().query.users.findFirst({ where: eq(schema.users.id, job.userId) });
  if (!user) throw new Error("Job owner not found");
  return user;
}

/** Pull new inbox message metadata (no bodies) into the emails table. */
async function syncInbox(job: Job) {
  const account = await getIntegration(job.userId, "google");
  const after = account?.lastSyncAt ? new Date(account.lastSyncAt.getTime() - SYNC_OVERLAP_MS) : new Date(Date.now() - FIRST_SYNC_LOOKBACK_MS);
  const startedAt = new Date();
  let ids: string[];
  try {
    ids = await listRecentMessageIds(job.userId, after, MAX_NEW_PER_SYNC);
  } catch (err) {
    // Surface fixable Google problems on the Integrations card and Inbox instead of failing silently.
    const m = errMessage(err);
    const human = /has not been used in project (\d+)|is disabled/i.test(m)
      ? `The Gmail API is turned off in your Google Cloud project${/project (\d+)/.exec(m)?.[1] ? ` (${/project (\d+)/.exec(m)![1]})` : ""}. Enable it under APIs & Services → Library → Gmail API, then click Sync now.`
      : /insufficient|scope/i.test(m)
        ? "Cowork doesn't have Gmail access. Reconnect Google and approve all permissions."
        : null;
    if (human) {
      await db().update(schema.integrations).set({ lastError: human }).where(and(eq(schema.integrations.userId, job.userId), eq(schema.integrations.provider, "google")));
    }
    throw err;
  }

  const existing = new Set(
    ids.length
      ? (
          await db()
            .select({ gmailId: schema.emails.gmailId })
            .from(schema.emails)
            .where(and(eq(schema.emails.userId, job.userId), inArray(schema.emails.gmailId, ids)))
        ).map((r) => r.gmailId)
      : [],
  );
  const fresh = ids.filter((id) => !existing.has(id));
  let inserted = 0;
  for (let i = 0; i < fresh.length; i += 10) {
    const metas = await Promise.all(fresh.slice(i, i + 10).map((id) => getMessageMeta(job.userId, id)));
    if (!metas.length) continue;
    const rows = await db()
      .insert(schema.emails)
      .values(
        metas.map((m) => ({
          userId: job.userId,
          gmailId: m.gmailId,
          threadId: m.threadId,
          fromName: m.fromName,
          fromEmail: m.fromEmail,
          subject: m.subject.slice(0, 500),
          snippet: m.snippet.slice(0, 500),
          receivedAt: m.receivedAt,
          labelIds: m.labelIds,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.emails.id });
    inserted += rows.length;
  }
  await db()
    .update(schema.integrations)
    .set({ lastSyncAt: startedAt, lastError: null })
    .where(and(eq(schema.integrations.userId, job.userId), eq(schema.integrations.provider, "google")));
  if (inserted > 0) await enqueue(job.userId, "classify_emails", {}, { dedupeKey: `classify:${job.userId}` });
  await logActivity({ userId: job.userId, actor: "agent", tool: "sync_inbox", inputSummary: `${inserted} new`, outcome: "success" });
  return { inserted };
}

/** Classify one batch; re-enqueue itself while more remain. Emits automation events and urgent alerts. */
async function classifyEmails(job: Job) {
  const batch = await unclassifiedEmails(job.userId, EMAIL_BATCH_SIZE);
  let ok = 0;
  let failed = 0;
  // Sequential to stay within provider rate limits on cheap tiers.
  for (const email of batch) {
    try {
      const c = await classifyEmail(job.userId, email);
      ok++;
      await emitEvent(job.userId, {
        type: "email",
        key: email.id,
        emailId: email.id,
        from: [email.fromName, email.fromEmail].filter(Boolean).join(" "),
        subject: email.subject,
        category: c.category,
        summary: c.summary,
      }).catch(() => 0);
      const fromCowork = /@antropic\.me$/i.test(email.fromEmail ?? "") || /onboarding@resend\.dev$/i.test(email.fromEmail ?? "");
      if (c.category === "URGENT" && !fromCowork) {
        await notify(job.userId, { kind: "urgent_email", title: `Urgent: ${email.subject}`.slice(0, 200), body: c.summary, href: "/inbox", dedupeKey: `urgent:${email.id}` });
      }
    } catch (err) {
      failed++;
      log.warn("classify.failed", { emailId: email.id, error: errMessage(err) });
    }
  }
  if (batch.length === EMAIL_BATCH_SIZE) {
    await enqueue(job.userId, "classify_emails", {}, { dedupeKey: `classify-next:${job.userId}:${job.id}` });
  }
  if (batch.length) {
    await logActivity({
      userId: job.userId,
      actor: "agent",
      tool: "classify_emails",
      inputSummary: `${batch.length} emails`,
      outcome: failed && !ok ? "error" : "success",
      detail: failed ? `${failed} failed` : null,
    });
  }
  if (failed && !ok) throw new Error(`All ${failed} classifications failed`);
  return { ok, failed };
}

async function dailyBriefing(job: Job) {
  const user = await ownerOf(job);
  const { created, briefing } = await generateDailyBriefing(user, { force: Boolean(job.payload.force) });
  if (created) {
    await logActivity({ userId: user.id, actor: "agent", tool: "daily_briefing", outcome: "success" });
    const s = await getSettings(user.id);
    if (s.notifyEmailDigest) await sendBriefingDigest(user, briefing.date, briefing.content);
    await notify(user.id, { kind: "briefing", title: "Your briefing is ready", body: briefing.content.headline, href: "/", dedupeKey: `briefing:${briefing.date}` });
  }
  return { created };
}

/** Admin broadcast: send a slice, then re-queue itself until everyone has it. */
async function broadcastJob(job: Job) {
  const id = String(job.payload.broadcastId);
  const done = await processBroadcast(id, 200_000);
  if (!done) await enqueue(job.userId, "broadcast", { broadcastId: id }, { dedupeKey: `broadcast:${id}:${Date.now()}` });
  return { done };
}

async function runAutomationJob(job: Job) {
  await runAutomation(String(job.payload.runId), job.attempts, job.maxAttempts);
}

async function fetchNews(job: Job) {
  const s = await getSettings(job.userId);
  const before = new Date();
  const result = await refreshNews(job.userId, s.newsTopics);
  if (result.inserted > 0) {
    const fresh = await db()
      .select({ id: schema.newsItems.id, title: schema.newsItems.title, sourceName: schema.newsItems.sourceName })
      .from(schema.newsItems)
      .where(and(eq(schema.newsItems.userId, job.userId), gte(schema.newsItems.createdAt, before)))
      .limit(50);
    for (const n of fresh) await emitEvent(job.userId, { type: "news_topic", key: n.id, title: n.title, source: n.sourceName, newsId: n.id }).catch(() => 0);
  }
  return result;
}

async function suggestIdeas(job: Job) {
  await suggestDailyIdeas(await ownerOf(job));
}

async function knowledgeSync(job: Job) {
  await syncKnowledgeSource(job.userId, String(job.payload.sourceId));
}

async function deliverReminders(job: Job) {
  const due = await dueReminders(job.userId);
  for (const t of due) {
    await notify(job.userId, { kind: "reminder", title: `Reminder: ${t.title}`.slice(0, 200), href: `/tasks?task=${t.id}`, dedupeKey: `reminder:${t.id}:${t.remindAt?.toISOString()}` });
    await db().update(schema.tasks).set({ reminderSentAt: new Date() }).where(eq(schema.tasks.id, t.id));
  }
  // Scheduled posts: remind me to post (publishing itself is always manual).
  const posts = await db()
    .select({ id: schema.contentDrafts.id, title: schema.contentDrafts.title, scheduledFor: schema.contentDrafts.scheduledFor })
    .from(schema.contentDrafts)
    .where(and(eq(schema.contentDrafts.userId, job.userId), eq(schema.contentDrafts.status, "scheduled"), lte(schema.contentDrafts.scheduledFor, new Date())))
    .limit(10);
  for (const p of posts) {
    await notify(job.userId, { kind: "post_reminder", title: `Time to post: ${p.title}`.slice(0, 200), body: "Your approved post is ready to copy.", href: `/content/${p.id}`, dedupeKey: `post:${p.id}:${p.scheduledFor?.toISOString()}` });
  }
  return { sent: due.length + posts.length };
}

const HANDLERS: Record<JobType, (job: Job) => Promise<unknown>> = {
  sync_inbox: syncInbox,
  classify_emails: classifyEmails,
  daily_briefing: dailyBriefing,
  run_automation: runAutomationJob,
  fetch_news: fetchNews,
  suggest_ideas: suggestIdeas,
  knowledge_sync: knowledgeSync,
  reminders: deliverReminders,
  broadcast: broadcastJob,
  agent_task: (job) => runAgentTask(job.userId, String(job.payload.taskId)),
  // Posts and comments published while the AI check was unavailable (lib/moderation/text.ts).
  moderate_content: (job) => recheckContent(job.payload as { postId?: string; commentId?: string }),
};

/**
 * Drain due jobs in small batches until the time budget is spent.
 * Leaves headroom so the function returns before Vercel's maxDuration.
 */
export async function processJobs(opts: { budgetMs: number; types?: JobType[]; batchSize?: number }) {
  const deadline = Date.now() + opts.budgetMs;
  await recoverStaleJobs();
  const summary = { processed: 0, succeeded: 0, failed: 0 };
  while (Date.now() < deadline) {
    const jobs = await claimBatch(opts.batchSize ?? 3, opts.types);
    if (!jobs.length) break;
    for (const job of jobs) {
      summary.processed++;
      try {
        const handler = HANDLERS[job.type as JobType];
        if (!handler) throw new Error(`Unknown job type: ${job.type}`);
        await handler(job);
        await markSucceeded(job);
        summary.succeeded++;
      } catch (err) {
        summary.failed++;
        log.error("job.failed", { jobId: job.id, type: job.type, attempts: job.attempts, error: errMessage(err) });
        await markFailed(job, err);
      }
    }
  }
  return summary;
}
