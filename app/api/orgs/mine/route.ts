import { handle } from "@/lib/social/http";
import { myOrgs } from "@/lib/business/orgs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await myOrgs(user) }));
}
