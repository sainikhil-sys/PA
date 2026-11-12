import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { viewers } from "@/lib/moments/service";

export const dynamic = "force-dynamic";

/** Author only: who saw it. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ items: await viewers(user.id, param((await params).id, uuidSchema)) }));
}
