import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { momentsOf } from "@/lib/moments/service";

export const dynamic = "force-dynamic";

/** One person's live Moments you may see, in play order. Media links expire after an hour. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ items: await momentsOf(user.id, param((await params).id, uuidSchema)) }));
}
