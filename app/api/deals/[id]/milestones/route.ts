import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { addMilestone } from "@/lib/business/deals";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await addMilestone(user, param((await params).id, uuidSchema), await body(req, z.object({ title: z.string().max(140), dueDate: z.string().max(10).nullish() })));
    return { ok: true };
  });
}
