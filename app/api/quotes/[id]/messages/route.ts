import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { postQuoteMessage } from "@/lib/business/deals";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { body: text } = await body(req, z.object({ body: z.string().max(4000) }));
    await postQuoteMessage(user, param((await params).id, uuidSchema), text);
    return { ok: true };
  });
}
