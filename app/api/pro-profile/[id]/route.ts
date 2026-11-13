import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { proProfileFor } from "@/lib/startups/service";

export const dynamic = "force-dynamic";

/** Someone's professional profile, if they show it to you; otherwise {profile: null}. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ profile: await proProfileFor(user.id, param((await params).id, uuidSchema)) }));
}
