import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { markViewed } from "@/lib/moments/service";

export const dynamic = "force-dynamic";

/** Mark a Moment as seen (its author can see who saw it). */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await markViewed(user.id, param((await params).id, uuidSchema));
    return { ok: true };
  });
}
