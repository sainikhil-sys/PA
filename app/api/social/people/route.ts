import { handle } from "@/lib/social/http";
import { searchPeople } from "@/lib/social/service";

export const dynamic = "force-dynamic";

/** Find people by handle or name. Only people who allow search (and friends) are returned. */
export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await searchPeople(user.id, new URL(req.url).searchParams.get("q") ?? "") }));
}
