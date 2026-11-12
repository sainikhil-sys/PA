import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { leaveSpace } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

/** Leave, or withdraw a request to join. An only owner has to hand over first. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await leaveSpace(user, param((await params).id, uuidSchema));
    return { ok: true };
  });
}
