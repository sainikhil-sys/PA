import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { joinSpace } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

/** Join (open), ask to join (by request), or join with an invite code. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const id = param((await params).id, uuidSchema);
    const { inviteCode } = await body(req, z.object({ inviteCode: z.string().max(40).nullish() }));
    return { space: await joinSpace(user, id, inviteCode) };
  });
}
