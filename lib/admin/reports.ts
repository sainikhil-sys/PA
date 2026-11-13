import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";

export type ReportStatus = "open" | "actioned" | "dismissed";
export const REPORT_STATUSES: ReportStatus[] = ["open", "actioned", "dismissed"];

/** Plain labels for the reasons people pick in the app (lib/social/rules.ts REPORT_REASONS). */
export const REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment or bullying",
  hate: "Hate",
  sexual: "Sexual content",
  violence: "Violence or threats",
  self_harm: "Self-harm",
  impersonation: "Impersonation",
  other: "Something else",
};

const reporter = alias(schema.users, "reporter");
const target = alias(schema.users, "target");
const targetProfile = alias(schema.socialProfiles, "target_profile");
const reviewer = alias(schema.users, "reviewer");

/** Reports for the console queue: newest first, with who reported whom and what was said. */
export async function listReports(status: ReportStatus, limit = 100) {
  const r = schema.userReports;
  return db()
    .select({
      id: r.id,
      reason: r.reason,
      details: r.details,
      snapshot: r.snapshot,
      status: r.status,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      threadId: r.threadId,
      messageId: r.messageId,
      messageDeleted: sql<boolean>`${schema.dmMessages.deletedAt} is not null`,
      postId: r.postId,
      commentId: r.commentId,
      /** The post or comment is already taken down (removed by an admin, or deleted by its author). */
      contentRemoved: sql<boolean>`coalesce(${schema.posts.status} = 'removed' or ${schema.posts.deletedAt} is not null, false) or coalesce(${schema.comments.status} = 'removed' or ${schema.comments.deletedAt} is not null, false)`,
      reporterEmail: reporter.email,
      targetId: r.targetUserId,
      targetEmail: target.email,
      targetHandle: targetProfile.handle,
      targetDisabled: sql<boolean>`${target.disabledAt} is not null`,
      reviewerEmail: reviewer.email,
      /** About a post or comment written under a pseudonym: who wrote it is hidden here (see maskAnonymous). */
      anonymous: sql<boolean>`(coalesce(${schema.posts.anonIdentityId} is not null, false) or coalesce(${schema.comments.anonIdentityId} is not null, false))`,
    })
    .from(r)
    .leftJoin(reporter, eq(reporter.id, r.reporterId))
    .leftJoin(target, eq(target.id, r.targetUserId))
    .leftJoin(targetProfile, eq(targetProfile.userId, r.targetUserId))
    .leftJoin(reviewer, eq(reviewer.id, r.reviewedBy))
    .leftJoin(schema.dmMessages, eq(schema.dmMessages.id, r.messageId))
    .leftJoin(schema.posts, eq(schema.posts.id, r.postId))
    .leftJoin(schema.comments, eq(schema.comments.id, r.commentId))
    .where(eq(r.status, status))
    .orderBy(status === "open" ? r.createdAt : desc(r.reviewedAt))
    .limit(limit);
}

export type ReportRow = Awaited<ReturnType<typeof listReports>>[number];

/**
 * The console never shows who wrote an anonymous post in the list: an admin with anonymous.reveal
 * uses the audited "Reveal author" action (lib/admin/ops/anonymous.ts) instead.
 */
export function maskAnonymous(rows: ReportRow[]): ReportRow[] {
  return rows.map((r) => (r.anonymous ? { ...r, targetEmail: null, targetHandle: null } : r));
}

export async function reportCounts(): Promise<Record<ReportStatus, number>> {
  const rows = await db()
    .select({ status: schema.userReports.status, n: sql<number>`count(*)::int` })
    .from(schema.userReports)
    .groupBy(schema.userReports.status);
  const out: Record<ReportStatus, number> = { open: 0, actioned: 0, dismissed: 0 };
  for (const row of rows) out[row.status] = row.n;
  return out;
}
