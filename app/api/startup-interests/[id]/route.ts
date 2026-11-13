import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { answerInterest } from "@/lib/startups/service";

export const dynamic = "force-dynamic";

/** Founders: {accept: true} adds them to the team and its Space; false declines. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { accept } = await body(req, z.object({ accept: z.boolean() }));
    await answerInterest(user, param((await params).id, uuidSchema), accept);
    return { ok: true };
  });
}
