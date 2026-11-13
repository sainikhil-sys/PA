import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { matchPeople } from "@/lib/startups/service";

export const dynamic = "force-dynamic";

/** Founders: people whose skills match what the startup needs and who are open to joining. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ items: await matchPeople(user, param((await params).id, uuidSchema)) }));
}
