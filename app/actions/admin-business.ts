"use server";

import { adminAction } from "@/lib/admin/adapters";
import { decideVerificationOp, setOrganizationStatusOp } from "@/lib/admin/ops/business";

/** Business verification and organization status (network.verify; audited). */
export const decideVerification = adminAction(decideVerificationOp);
export const setOrganizationStatus = adminAction(setOrganizationStatusOp);
