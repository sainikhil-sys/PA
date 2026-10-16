import { apiGuard } from "@/lib/auth/api";
import { flowEvents } from "@/lib/flow/server";
import { nextCursor } from "@/lib/flow/model";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";

/**
 * Event feed for the Live Link panel and Flow page: GET ?since=<ISO cursor>&run=<id>.
 * Returns span metadata (labels, node, status, counts) — never content.
 * Transport-agnostic: the same payload can later be pushed over Ably/Pusher.
 */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const run = url.searchParams.get("run");
  if (run && !/^[0-9a-f-]{36}$/i.test(run)) return errorJson(400, "invalid run");
  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  if (since && Number.isNaN(since.getTime())) return errorJson(400, "invalid cursor");
  const spans = await flowEvents(g.user.id, { since, runId: run ?? undefined });
  return Response.json({ spans, cursor: nextCursor(sinceRaw, spans), serverTime: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
