"use server";

import { adminAction } from "@/lib/admin/adapters";
import { completeDeletionRequestOp, recordDeletionRequestOp, rejectDeletionRequestOp, verifyDeletionRequestOp } from "@/lib/admin/ops/deletion";
import { setUserDisabledOp } from "@/lib/admin/ops/legacy";
import { addRestrictionOp, liftRestrictionOp, revokeUserSessionsOp, suspendUsersOp } from "@/lib/admin/ops/users";

/**
 * Users and deletion requests. Each action only runs a shared op (lib/admin/ops/*) through the
 * pipeline in lib/admin/op.ts. Destructive ones take the confirmation token as a second argument.
 */

/** Single suspend and restore, the same op as /api/admin/users/[userId]/disabled. */
export const setUserSuspended = adminAction(setUserDisabledOp);
export const suspendUsers = adminAction(suspendUsersOp);
export const revokeUserSessions = adminAction(revokeUserSessionsOp);
export const addUserRestriction = adminAction(addRestrictionOp);
export const liftUserRestriction = adminAction(liftRestrictionOp);

export const recordDeletionRequest = adminAction(recordDeletionRequestOp);
export const verifyDeletionRequest = adminAction(verifyDeletionRequestOp);
export const rejectDeletionRequest = adminAction(rejectDeletionRequestOp);
export const completeDeletionRequest = adminAction(completeDeletionRequestOp);
