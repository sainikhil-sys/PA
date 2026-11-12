"use server";

import { revalidatePath } from "next/cache";
import { adminAction } from "@/lib/admin/adapters";
import { aiConfigUpdateOp, appearanceUpdateOp, configHistoryOp, configRollbackOp, configUpdateOp, maintenanceSetOp, type ConfigUpdateInput } from "@/lib/admin/ops/config";
import { configEntry } from "@/lib/config/registry";

/**
 * Configuration console actions. Each one only runs a shared op (lib/admin/ops/config.ts) through the
 * admin pipeline, which checks the role, the admin session and the permission, and writes the audit row.
 */

const update = adminAction(configUpdateOp);
const updateAppearance = adminAction(appearanceUpdateOp);
const updateAi = adminAction(aiConfigUpdateOp);

/** Appearance keys need appearance.write, AI keys ai.write; everything else in the editor needs config.write. */
function updateFor(input: ConfigUpdateInput) {
  const permission = configEntry(input.key)?.permission;
  return permission === "appearance.write" ? updateAppearance : permission === "ai.write" ? updateAi : update;
}

export async function updateConfig(input: ConfigUpdateInput) {
  const r = await updateFor(input)(input);
  if (r.ok) {
    revalidatePath("/console/config");
    revalidatePath("/console/ai");
  }
  return r;
}

const rollback = adminAction(configRollbackOp);
export async function rollbackConfig(input: Parameters<typeof rollback>[0], confirmToken?: string) {
  const r = await rollback(input, confirmToken);
  if (r.ok) revalidatePath("/console/config");
  return r;
}

const maintenance = adminAction(maintenanceSetOp);
export async function setMaintenance(input: Parameters<typeof maintenance>[0], confirmToken?: string) {
  const r = await maintenance(input, confirmToken);
  if (r.ok) revalidatePath("/console/config");
  return r;
}

export const configHistoryRead = adminAction(configHistoryOp);
