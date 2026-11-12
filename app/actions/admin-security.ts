"use server";

import { revalidatePath } from "next/cache";
import { adminAction } from "@/lib/admin/adapters";
import { changeRoleOp, grantRoleOp, resetMfaOp, revokeAdminSessionOp, revokeOwnAdminSessionOp, revokeRoleOp } from "@/lib/admin/ops/security";

/**
 * Security centre actions. Each only runs a shared op through the admin pipeline (role, admin session,
 * permission, confirmation for destructive ones, audit row). The audit CSV export is a route
 * (app/api/admin/audit/export) so the browser can save the file.
 */

const grant = adminAction(grantRoleOp);
export async function grantAdminRole(input: Parameters<typeof grant>[0], confirmToken?: string) {
  const r = await grant(input, confirmToken);
  if (r.ok) revalidatePath("/console/security");
  return r;
}

const change = adminAction(changeRoleOp);
export async function changeAdminRole(input: Parameters<typeof change>[0], confirmToken?: string) {
  const r = await change(input, confirmToken);
  if (r.ok) revalidatePath("/console/security");
  return r;
}

const revoke = adminAction(revokeRoleOp);
export async function revokeAdminRole(input: Parameters<typeof revoke>[0], confirmToken?: string) {
  const r = await revoke(input, confirmToken);
  if (r.ok) revalidatePath("/console/security");
  return r;
}

const reset = adminAction(resetMfaOp);
export async function resetAdminMfa(input: Parameters<typeof reset>[0], confirmToken?: string) {
  const r = await reset(input, confirmToken);
  if (r.ok) revalidatePath("/console/security");
  return r;
}

const endSession = adminAction(revokeAdminSessionOp);
export async function revokeAdminSession(input: Parameters<typeof endSession>[0]) {
  const r = await endSession(input);
  if (r.ok) revalidatePath("/console/security");
  return r;
}

const endOwnSession = adminAction(revokeOwnAdminSessionOp);
export async function revokeMyAdminSession(input: Parameters<typeof endOwnSession>[0]) {
  const r = await endOwnSession(input);
  if (r.ok) revalidatePath("/console/security");
  return r;
}
