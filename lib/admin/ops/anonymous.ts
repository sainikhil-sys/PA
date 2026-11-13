import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/auth/action";
import { schema } from "@/lib/db";
import { adminOp } from "../op";

/**
 * Reveal which account wrote a reported anonymous post or comment. Only admins and the owner hold
 * anonymous.reveal; a reason is required and every reveal writes an audit row (in the same
 * transaction) naming the report, never the content. Moderators review anonymous reports without it.
 */
export const revealAnonymousAuthorOp = adminOp({
  action: "anonymous.reveal",
  resourceType: "user_report",
  permission: "anonymous.reveal",
  kind: "write",
  input: z.object({
    reportId: z.string().uuid(),
    reason: z.string().trim().min(10, "Say why you need to know who wrote it (at least 10 characters).").max(500),
  }),
  run: async ({ reportId, reason }, { tx, record }) => {
    const [row] = await tx
      .select({ targetUserId: schema.userReports.targetUserId, email: schema.users.email, handle: schema.socialProfiles.handle })
      .from(schema.userReports)
      .leftJoin(schema.users, eq(schema.users.id, schema.userReports.targetUserId))
      .leftJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, schema.userReports.targetUserId))
      .where(eq(schema.userReports.id, reportId))
      .limit(1);
    if (!row?.targetUserId) throw new UserFacingError("That report has no author to reveal (the account may have been deleted).");
    record({ resourceId: reportId, before: null, after: { revealed: true, targetUserId: row.targetUserId }, reason });
    return { email: row.email, handle: row.handle };
  },
});
