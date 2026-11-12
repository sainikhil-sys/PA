"use server";

import { revalidatePath } from "next/cache";
import { adminAction } from "@/lib/admin/adapters";
import { draftBroadcastOp, removeBroadcastFileOp, retryDeadJobOp, sendBroadcastOp, sendBroadcastTestOp, setUserDisabledOp, testServerAiOp } from "@/lib/admin/ops/legacy";

/**
 * Console server actions. Each one only runs a shared op (lib/admin/ops/*) through the pipeline in
 * lib/admin/op.ts, which checks the role, the admin session and the permission, and writes the audit row.
 */

const disable = adminAction(setUserDisabledOp);
export async function setUserDisabled(input: Parameters<typeof disable>[0]) {
  const r = await disable(input);
  if (r.ok) revalidatePath("/console/users");
  return r;
}

export const draftBroadcast = adminAction(draftBroadcastOp);

const send = adminAction(sendBroadcastOp);
export async function sendBroadcast(input: Parameters<typeof send>[0]) {
  const r = await send(input);
  if (r.ok) revalidatePath("/console/broadcast");
  return r;
}

export const sendBroadcastTest = adminAction(sendBroadcastTestOp);
export const removeBroadcastFile = adminAction(removeBroadcastFileOp);

const retry = adminAction(retryDeadJobOp);
export async function retryDeadJob(input: Parameters<typeof retry>[0]) {
  const r = await retry(input);
  if (r.ok) revalidatePath("/console/system");
  return r;
}

export const testServerAi = adminAction(testServerAiOp);
