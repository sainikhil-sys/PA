import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { moderatePost } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

/** A Space's owners and moderators: pin, unpin or take down a post in their Space. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { action } = await body(req, z.object({ action: z.enum(["pin", "unpin", "remove"]) }));
    await moderatePost(user, param((await params).id, uuidSchema), action);
    return { ok: true };
  });
}
