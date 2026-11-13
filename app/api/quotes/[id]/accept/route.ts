import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { acceptQuote } from "@/lib/business/deals";

export const dynamic = "force-dynamic";

/** Buyer admins: accept a quote. Opens a deal waiting for the supplier's approval. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { note } = await body(req, z.object({ note: z.string().max(1000).optional() }));
    return { dealId: await acceptQuote(user, param((await params).id, uuidSchema), note ?? "") };
  });
}
