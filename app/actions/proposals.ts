"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dismissProposal, executeProposal } from "@/lib/agent/proposals";
import { ownerAction, UserFacingError } from "@/lib/auth/action";

/** The ONLY path by which agent/voice/automation proposals execute: an explicit click. */
export const approveProposalAction = ownerAction(
  z.object({ id: z.string().uuid(), edits: z.object({ title: z.string().max(200).optional(), when: z.string().max(100).optional() }).optional() }),
  async ({ id, edits }, user) => {
    const res = await executeProposal(user, id, edits);
    if (!res.ok) throw new UserFacingError(res.message);
    revalidatePath("/", "layout");
    return { message: res.message, href: res.href };
  },
);

export const dismissProposalAction = ownerAction(z.object({ id: z.string().uuid() }), async ({ id }, user) => {
  await dismissProposal(user.id, id);
});
