"use server";

import { revalidatePath } from "next/cache";
import { adminAction } from "@/lib/admin/adapters";
import { policyChangeNeeds, policyMandatoryOp, policyUpdateOp, releaseCreateOp, releaseStatusOp, type PolicyInput } from "@/lib/admin/ops/releases";

/** Releases console actions; each runs a shared op through the admin pipeline (lib/admin/op.ts). */

const policyUpdate = adminAction(policyUpdateOp);
const policyMandatory = adminAction(policyMandatoryOp);

/** Raising the build everyone must have is owner-only with confirmation; other edits need releases.write. */
async function savePolicy(input: PolicyInput, confirmToken?: string) {
  const needs = await policyChangeNeeds(input.policy).catch(() => null);
  return needs?.permission === "releases.mandatory" ? policyMandatory(input, confirmToken) : policyUpdate(input);
}

export async function updatePolicy(input: PolicyInput, confirmToken?: string) {
  const r = await savePolicy(input, confirmToken);
  if (r.ok) revalidatePath("/console/releases");
  return r;
}

const create = adminAction(releaseCreateOp);
export async function createRelease(input: Parameters<typeof create>[0]) {
  const r = await create(input);
  if (r.ok) revalidatePath("/console/releases");
  return r;
}

const setStatus = adminAction(releaseStatusOp);
export async function setReleaseStatus(input: Parameters<typeof setStatus>[0]) {
  const r = await setStatus(input);
  if (r.ok) revalidatePath("/console/releases");
  return r;
}
