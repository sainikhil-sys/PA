import { apiGuard } from "@/lib/auth/api";
import { getIntegration } from "@/lib/db/queries/settings";
import { nowPlaying, spotify } from "@/lib/spotify";

export const dynamic = "force-dynamic";

/** What's playing on the user's Spotify (any device). { connected: false } if Spotify isn't linked. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const row = await getIntegration(g.user.id, "spotify");
  if (row?.status !== "connected") return Response.json({ connected: false }, { headers: { "cache-control": "no-store" } });
  // Spotify answers 403 to EVERY call when the app owner lacks Premium (Spotify policy since 2025).
  const probe = await spotify(g.user.id, "/me").catch(() => null);
  if (probe?.status === 403) return Response.json({ connected: true, blocked: true }, { headers: { "cache-control": "no-store" } });
  const now = await nowPlaying(g.user.id).catch(() => null);
  return Response.json({ connected: true, premium: Boolean((row.config as { premium?: boolean })?.premium), now }, { headers: { "cache-control": "no-store" } });
}
