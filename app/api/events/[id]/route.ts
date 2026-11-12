import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { cancelEvent } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

/** Owners and moderators: cancel an event (it stays listed as cancelled). */
export async function DELETE(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await cancelEvent(user, param((await params).id, uuidSchema));
    return { ok: true };
  });
}
