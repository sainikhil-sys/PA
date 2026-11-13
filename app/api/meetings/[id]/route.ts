import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { cancelMeeting } from "@/lib/business/deals";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await cancelMeeting(user, param((await params).id, uuidSchema));
    return { ok: true };
  });
}
