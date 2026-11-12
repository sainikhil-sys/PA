"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { isAdmin } from "@/lib/auth/policy";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";

/**
 * Reviewing reports from the console. Every action re-checks the admin role server-side, records
 * who reviewed it, and writes an activity row (the console's audit trail).
 */
const resolveInput = z.object({
  reportId: z.string().uuid(),
  outcome: z.enum(["dismiss", "remove_message", "remove_content", "disable_account"]),
});

const ALREADY = "Someone already reviewed this report.";

export const resolveReport = ownerAction(resolveInput, async ({ reportId, outcome }, user) => {
  if (!isAdmin(user.email)) throw new Error("Not found");

  await db().transaction(async (tx) => {
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
      // Same as Disable on the Users tab: no sign-in, and every session ends now.
      await tx.update(schema.users).set({ disabledAt: new Date() }).where(eq(schema.users.id, report.targetUserId));
      await tx
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.sessions.userId, report.targetUserId), isNull(schema.sessions.revokedAt)));
    }
  });

  await logActivity({ userId: user.id, actor: "me", tool: `admin.report_${outcome}`, inputSummary: `report ${reportId}`, outcome: "success" });
  revalidatePath("/console/reports");
});
