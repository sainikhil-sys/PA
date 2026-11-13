import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { answerPartnership } from "@/lib/business/orgs";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { accept } = await body(req, z.object({ accept: z.boolean() }));
    await answerPartnership(user, param((await params).id, uuidSchema), accept);
    return { ok: true };
  });
}
