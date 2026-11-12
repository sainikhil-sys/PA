import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/auth/action";
import { schema } from "@/lib/db";
import { revokeAdminSessions } from "../admin-session";
import { adminOp } from "../op";
import { can } from "../permissions";

/**
 * Reviewing reports people filed in the app. Runs through the admin pipeline (role, unlocked console,
 * community.moderate, audit row in the same transaction). Disabling the reported account also needs
 * users.suspend, so a moderator can remove content but not suspend people.
 */
const ALREADY = "Someone already reviewed this report.";

export const resolveReportOp = adminOp({
  action: "report.resolve",
  resourceType: "user_report",
  permission: "community.moderate",
  kind: "write",
  input: z.object({
    reportId: z.string().uuid(),
    outcome: z.enum(["dismiss", "remove_message", "remove_content", "disable_account"]),
  }),
  run: async ({ reportId, outcome }, { user, role, tx, record }) => {
    if (outcome === "disable_account" && !can(role, "users.suspend")) throw new UserFacingError("Your role can't disable accounts. Remove the content, or ask an admin.");
    // Claim the report first: only an open report can be resolved, so two reviewers can't both act.
    const [report] = await tx
      .update(schema.userReports)
      .set({ status: outcome === "dismiss" ? "dismissed" : "actioned", reviewedBy: user.id, reviewedAt: new Date() })
      .where(and(eq(schema.userReports.id, reportId), eq(schema.userReports.status, "open")))
      .returning();
    if (!report) throw new UserFacingError(ALREADY);

    if (outcome === "remove_message") {
      if (!report.messageId) throw new UserFacingError("This report isn't about a message.");
      // Deleted for everyone, the same as a sender deleting it: the body is cleared, the marker stays.
      await tx
        .update(schema.dmMessages)
        .set({ body: "", deletedAt: new Date() })
        .where(and(eq(schema.dmMessages.id, report.messageId), isNull(schema.dmMessages.deletedAt)));
    }
    if (outcome === "remove_content") {
      if (!report.postId && !report.commentId) throw new UserFacingError("This report isn't about a post or a comment.");
      // Taken down for everyone; the author sees it as removed. A removed comment no longer counts.
      if (report.postId) await tx.update(schema.posts).set({ status: "removed" }).where(eq(schema.posts.id, report.postId));
      if (report.commentId) {
        const [cm] = await tx
          .update(schema.comments)
          .set({ status: "removed" })
          .where(and(eq(schema.comments.id, report.commentId), eq(schema.comments.status, "published")))
          .returning({ postId: schema.comments.postId });
        if (cm) await tx.update(schema.posts).set({ commentCount: sql`greatest(${schema.posts.commentCount} - 1, 0)` }).where(eq(schema.posts.id, cm.postId));
      }
    }
    if (outcome === "disable_account") {
      if (!report.targetUserId) throw new UserFacingError("This report has no account to disable.");
      if (report.targetUserId === user.id) throw new UserFacingError("You can't disable your own account.");
      // Same as Suspend on the Users page: no sign-in, every session (and admin session) ends now.
      await tx.update(schema.users).set({ disabledAt: new Date() }).where(eq(schema.users.id, report.targetUserId));
      await tx.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, report.targetUserId), isNull(schema.sessions.revokedAt)));
      await revokeAdminSessions(report.targetUserId, tx);
    }
    // The audit row names the report and the decision, never the reported content.
    record({ resourceId: reportId, before: { status: "open" }, after: { outcome, targetUserId: report.targetUserId ?? null } });
  },
});
