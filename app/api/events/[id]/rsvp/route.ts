import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { rsvp } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

/** Members: going, maybe or not going. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { status } = await body(req, z.object({ status: z.enum(["going", "maybe", "not_going"]) }));
    await rsvp(user, param((await params).id, uuidSchema), status);
    return { ok: true };
  });
}
