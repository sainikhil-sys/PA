import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { listInterests } from "@/lib/startups/service";

export const dynamic = "force-dynamic";

/** Founders: pending requests to join. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ items: await listInterests(user, param((await params).id, uuidSchema)) }));
}
