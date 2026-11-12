"use server";

import { revalidatePath } from "next/cache";
import { adminAction } from "@/lib/admin/adapters";
import { flagHistoryOp, flagRestoreOp, flagUpdateOp } from "@/lib/admin/ops/flags";

/** Feature flag console actions; each runs a shared op through the admin pipeline (lib/admin/op.ts). */

const update = adminAction(flagUpdateOp);
export async function updateFlag(input: Parameters<typeof update>[0]) {
  const r = await update(input);
  if (r.ok) revalidatePath("/console/flags");
  return r;
}

const restore = adminAction(flagRestoreOp);
export async function restoreFlag(input: Parameters<typeof restore>[0]) {
  const r = await restore(input);
  if (r.ok) revalidatePath("/console/flags");
  return r;
}

export const flagHistoryRead = adminAction(flagHistoryOp);
