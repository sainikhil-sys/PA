import { handle } from "@/lib/social/http";
import { myStartups } from "@/lib/startups/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await myStartups(user) }));
}
