import "server-only";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { UserFacingError } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import { RESTRICTABLE_FEATURES } from "@/lib/db/schema";
import { revokeAdminSessions } from "../admin-session";
import { adminOp } from "../op";
import { refusal } from "./deletion";
import { FEATURE_LABEL, isActiveRestriction } from "../restrictions";
import { searchUsers, userDetail, userSearchSchema } from "../users-query";

/**
 * Users: search, detail, session revocation, per-feature restrictions and bulk suspension.
 * Single suspend and restore stay on setUserDisabledOp (lib/admin/ops/legacy.ts).
 */

const uuid = z.string().uuid();
const reason = z.string().trim().min(3, "Add a short reason").max(500);

export const searchUsersOp = adminOp({
  action: "users.search",
  resourceType: "user",
  permission: "users.read",
  kind: "read",
  input: userSearchSchema,
  run: (input) => searchUsers(input),
});

export const userDetailOp = adminOp({
  action: "users.detail",
  resourceType: "user",
  permission: "users.read",
  kind: "read",
  input: z.object({ userId: uuid }),
  run: async ({ userId }) => {
    const d = await userDetail(userId);
    if (!d) throw new UserFacingError("That account no longer exists.");
    return d;
  },
});

const liveSessions = (userId: string) => and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date()));

/** Signs the person out on every device, including any admin session they hold. */
export const revokeUserSessionsOp = adminOp({
  action: "user.sessions_revoke",
  resourceType: "user",
  permission: "users.sessions.revoke",
  kind: "write",
  input: z.object({ userId: uuid, reason: reason.optional() }),
  run: async ({ userId, reason: why }, { user, tx, record }) => {
    if (userId === user.id) throw new UserFacingError("To sign yourself out everywhere, use Settings.");
    const [exists] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!exists) throw new UserFacingError("That account no longer exists.");
    const revoked = await tx.update(schema.sessions).set({ revokedAt: new Date() }).where(liveSessions(userId)).returning({ id: schema.sessions.id });
    await revokeAdminSessions(userId, tx);
    record({ resourceId: userId, before: { liveSessions: revoked.length }, after: { liveSessions: 0 }, reason: why ?? null });
    return { revoked: revoked.length };
  },
});

const futureDate = z.coerce
  .date()
  .refine((d) => d.getTime() > Date.now() + 60_000, "Pick an end time in the future")
  .refine((d) => d.getTime() < Date.now() + 366 * 86_400_000, "Pick an end time within a year");

/** Restrict one feature. An active restriction on the same feature is replaced (lifted, then re-added). */
export const addRestrictionOp = adminOp({
  action: "user.restrict",
  resourceType: "user",
  permission: "users.suspend",
  kind: "write",
  input: z.object({ userId: uuid, feature: z.enum(RESTRICTABLE_FEATURES), reason, expiresAt: futureDate.optional().nullable() }),
  run: async ({ userId, feature, reason: why, expiresAt }, { user, tx, record }) => {
    if (userId === user.id) throw new UserFacingError("You can't restrict your own account.");
    const [exists] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!exists) throw new UserFacingError("That account no longer exists.");
    const current = await tx
      .select({ id: schema.userRestrictions.id, expiresAt: schema.userRestrictions.expiresAt, liftedAt: schema.userRestrictions.liftedAt })
      .from(schema.userRestrictions)
      .where(and(eq(schema.userRestrictions.userId, userId), eq(schema.userRestrictions.feature, feature), isNull(schema.userRestrictions.liftedAt)));
    const active = current.filter((r) => isActiveRestriction(r));
    if (current.length) await tx.update(schema.userRestrictions).set({ liftedAt: new Date() }).where(inArray(schema.userRestrictions.id, current.map((r) => r.id)));
    const [row] = await tx
      .insert(schema.userRestrictions)
      .values({ userId, feature, reason: why, expiresAt: expiresAt ?? null, createdBy: user.id })
      .returning({ id: schema.userRestrictions.id });
    record({
      resourceId: userId,
      before: { feature, restricted: active.length > 0, expiresAt: active[0]?.expiresAt?.toISOString() ?? null },
      after: { feature, restricted: true, expiresAt: expiresAt?.toISOString() ?? null, restrictionId: row!.id },
      reason: why,
    });
    return { id: row!.id, feature: FEATURE_LABEL[feature] };
  },
});

export const liftRestrictionOp = adminOp({
  action: "user.unrestrict",
  resourceType: "user",
  permission: "users.suspend",
  kind: "write",
  input: z.object({ userId: uuid, restrictionId: uuid, reason: reason.optional() }),
  run: async ({ userId, restrictionId, reason: why }, { tx, record }) => {
    const [r] = await tx
      .select({ feature: schema.userRestrictions.feature, liftedAt: schema.userRestrictions.liftedAt, expiresAt: schema.userRestrictions.expiresAt })
      .from(schema.userRestrictions)
      .where(and(eq(schema.userRestrictions.id, restrictionId), eq(schema.userRestrictions.userId, userId)))
      .limit(1);
    if (!r) throw new UserFacingError("That restriction no longer exists.");
    if (r.liftedAt) throw new UserFacingError("That restriction was already lifted.");
    await tx.update(schema.userRestrictions).set({ liftedAt: new Date() }).where(eq(schema.userRestrictions.id, restrictionId));
    record({ resourceId: userId, before: { feature: r.feature, restricted: isActiveRestriction(r) }, after: { feature: r.feature, restricted: false, restrictionId }, reason: why ?? null });
    return { feature: FEATURE_LABEL[r.feature] };
  },
});

const bulkInput = z.object({ userIds: z.array(uuid).min(1, "Select at least one account").max(100, "Suspend up to 100 accounts at a time"), reason });

/** Who would be suspended, and why some can't be. Shared by the summary and the commit. */
async function bulkTargets(userIds: string[], actorId: string, executor: Pick<ReturnType<typeof db>, "select"> = db()) {
  const ids = [...new Set(userIds)];
  if (ids.includes(actorId)) throw new UserFacingError("You can't suspend your own account. Clear it from the selection.");
  const rows = await executor
    .select({ id: schema.users.id, email: schema.users.email, disabledAt: schema.users.disabledAt })
    .from(schema.users)
    .where(inArray(schema.users.id, ids));
  const owners = await executor
    .select({ userId: schema.adminRoleAssignments.userId })
    .from(schema.adminRoleAssignments)
    .where(and(inArray(schema.adminRoleAssignments.userId, ids), eq(schema.adminRoleAssignments.role, "owner"), isNull(schema.adminRoleAssignments.revokedAt)));
  if (owners.length) throw new UserFacingError("The owner's account can't be suspended. Clear it from the selection.");
  const targets = rows.filter((r) => !r.disabledAt);
  if (!targets.length) throw new UserFacingError("Those accounts are already suspended.");
  return targets;
}

/** Suspending several accounts at once is destructive: the console shows a summary and asks again. */
export const suspendUsersOp = adminOp({
  action: "users.suspend_many",
  resourceType: "user",
  permission: "users.suspend",
  kind: "write",
  risk: "destructive",
  input: bulkInput,
  summary: async ({ userIds }, user) => {
    const targets = await bulkTargets(userIds, user.id).catch(refusal);
    if (typeof targets === "string") return targets;
    const [s] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.sessions)
      .where(and(inArray(schema.sessions.userId, targets.map((t) => t.id)), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())));
    const shown = targets.slice(0, 3).map((t) => t.email);
    const more = targets.length > 3 ? ` and ${targets.length - 3} more` : "";
    const sessions = Number(s?.n ?? 0);
    return `Suspend ${targets.length} account${targets.length === 1 ? "" : "s"} (${shown.join(", ")}${more}) and sign them out of ${sessions} session${sessions === 1 ? "" : "s"}. They can't sign in until you restore them.`;
  },
  run: async ({ userIds, reason: why }, { user, tx, record }) => {
    const targets = await bulkTargets(userIds, user.id, tx);
    const ids = targets.map((t) => t.id);
    const now = new Date();
    await tx.update(schema.users).set({ disabledAt: now }).where(and(inArray(schema.users.id, ids), isNull(schema.users.disabledAt)));
    await tx.update(schema.sessions).set({ revokedAt: now }).where(and(inArray(schema.sessions.userId, ids), isNull(schema.sessions.revokedAt)));
    await tx.update(schema.adminSessions).set({ revokedAt: now }).where(and(inArray(schema.adminSessions.userId, ids), isNull(schema.adminSessions.revokedAt)));
    record({ resourceId: null, before: { userIds: ids, disabled: false }, after: { userIds: ids, disabled: true }, reason: why });
    return { suspended: ids.length };
  },
});
