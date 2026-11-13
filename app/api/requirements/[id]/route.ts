import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { getRequirement, setRequirementStatus } from "@/lib/business/deals";

export const dynamic = "force-dynamic";

/** The requirement; the buyer sees every quote, a supplier only its own. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => getRequirement(user, param((await params).id, uuidSchema)));
}

/** Buyer admins: close, cancel or reopen. */
export async function PATCH(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { status } = await body(req, z.object({ status: z.enum(["open", "closed", "cancelled"]) }));
    await setRequirementStatus(user, param((await params).id, uuidSchema), status);
    return { ok: true };
  });
}
