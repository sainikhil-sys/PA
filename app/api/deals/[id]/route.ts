import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { getDeal, setDealStatus } from "@/lib/business/deals";

export const dynamic = "force-dynamic";

/** The deal: both sides, approvals, milestones, meetings, terms history and messages. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => getDeal(user, param((await params).id, uuidSchema)));
}

/** Admins of either side: in progress, completed or cancelled. */
export async function PATCH(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { status } = await body(req, z.object({ status: z.enum(["in_progress", "completed", "cancelled"]) }));
    await setDealStatus(user, param((await params).id, uuidSchema), status);
    return { ok: true };
  });
}
