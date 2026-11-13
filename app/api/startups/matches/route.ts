import { handle } from "@/lib/social/http";
import { matchStartups } from "@/lib/startups/service";

export const dynamic = "force-dynamic";

/** Startups that need skills on your professional profile, best match first. */
export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await matchStartups(user) }));
}
