import { apiGuard } from "@/lib/auth/api";
import { listPhoneFeed } from "@/lib/phone-server";

export const dynamic = "force-dynamic";

/** Live feed for the Phone page (polled every few seconds). */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  return Response.json(await listPhoneFeed(g.user.id), { headers: { "cache-control": "no-store" } });
}
