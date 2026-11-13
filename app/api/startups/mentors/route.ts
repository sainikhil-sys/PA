import { handle } from "@/lib/social/http";
import { findMentors } from "@/lib/startups/service";

export const dynamic = "force-dynamic";

/** People open to mentoring: ?skill= */
export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await findMentors(user, new URL(req.url).searchParams.get("skill") ?? undefined) }));
}
