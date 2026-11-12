import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { deleteMoment } from "@/lib/moments/service";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await deleteMoment(user.id, param((await params).id, uuidSchema));
    return { ok: true };
  });
}
