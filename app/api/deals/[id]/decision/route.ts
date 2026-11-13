import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { decideDeal } from "@/lib/business/deals";

export const dynamic = "force-dynamic";

/** Admins: approve or reject the deal's terms for your organization. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { decision, note } = await body(req, z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().max(1000).optional() }));
    await decideDeal(user, param((await params).id, uuidSchema), decision, note ?? "");
    return { ok: true };
  });
}
