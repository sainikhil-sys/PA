import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { submitQuote } from "@/lib/business/deals";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const terms = z.object({
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  deliveryDays: z.number().int().min(0).max(3650).nullish(),
  terms: z.string().max(5000).optional(),
  validUntil: z.coerce.date().nullish(),
});

/** Quote for your verified supplier organization. Amounts are in minor units (cents). */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const input = await body(req, terms.extend({ supplierOrgId: uuidSchema }));
    const { supplierOrgId, ...t } = input;
    return { id: await submitQuote(user, param((await params).id, uuidSchema), supplierOrgId, t) };
  });
}
