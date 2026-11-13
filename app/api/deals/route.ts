import { handle } from "@/lib/social/http";
import { myDeals } from "@/lib/business/deals";

export const dynamic = "force-dynamic";

/** Deals of every organization you act for. */
export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await myDeals(user) }));
}
