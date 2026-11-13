import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { quoteHistory, setQuoteStatus } from "@/lib/business/deals";

export const dynamic = "force-dynamic";

/** The negotiation: every terms version and the messages. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => quoteHistory(user, param((await params).id, uuidSchema)));
}

/** Buyer: shortlist or reject (or back to submitted). Supplier: withdraw. */
export async function PATCH(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { status } = await body(req, z.object({ status: z.enum(["shortlisted", "rejected", "withdrawn", "submitted"]) }));
    await setQuoteStatus(user, param((await params).id, uuidSchema), status);
    return { ok: true };
  });
}
