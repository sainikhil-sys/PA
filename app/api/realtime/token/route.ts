import { apiGuard } from "@/lib/auth/api";
import { noStore } from "@/lib/mobile/http";
import { mintRealtimeToken, REALTIME_TOKEN_TTL_S, realtimeConfig, userTopic } from "@/lib/realtime/token";

export const dynamic = "force-dynamic";

/**
 * Where and how this person listens for live updates. With realtime not configured it answers
 * `{ enabled: false }` and the app keeps polling. The token only opens the caller's own channel.
 */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const cfg = realtimeConfig();
  if (!cfg) return Response.json({ enabled: false }, { headers: noStore });
  const { token, expiresAt } = mintRealtimeToken(g.user.id, cfg.jwtSecret);
  return Response.json(
    { enabled: true, url: cfg.url, anonKey: cfg.anonKey, token, topic: userTopic(g.user.id), expiresAt, refreshAfterS: REALTIME_TOKEN_TTL_S - 120 },
    { headers: noStore },
  );
}
