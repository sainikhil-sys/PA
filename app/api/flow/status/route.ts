import { apiGuard } from "@/lib/auth/api";
import { flowStatus } from "@/lib/flow/server";

export const dynamic = "force-dynamic";

/** Per node: connected, enabled, 1-hour calls/errors, last activity, permissions. Cached ~4s server-side. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  return Response.json({ nodes: await flowStatus(g.user.id), serverTime: new Date().toISOString() }, { headers: { "cache-control": "private, max-age=3" } });
}
