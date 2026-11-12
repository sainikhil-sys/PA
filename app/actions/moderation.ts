"use server";

import { revalidatePath } from "next/cache";
import { adminAction } from "@/lib/admin/adapters";
import { resolveReportOp } from "@/lib/admin/ops/moderation";

/**
 * Reviewing reports from the console. The op (lib/admin/ops/moderation.ts) checks the role, the
 * unlocked console and community.moderate, and writes the audit row with the change.
 */
const resolve = adminAction(resolveReportOp);
export async function resolveReport(input: Parameters<typeof resolve>[0]) {
  const r = await resolve(input);
  if (r.ok) revalidatePath("/console/reports");
  return r;
}
