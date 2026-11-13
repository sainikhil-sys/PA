import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { setMilestoneDone } from "@/lib/business/deals";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { done } = await body(req, z.object({ done: z.boolean() }));
    await setMilestoneDone(user, param((await params).id, uuidSchema), done);
    return { ok: true };
  });
}
