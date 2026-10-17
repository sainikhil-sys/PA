import { apiGuard } from "@/lib/auth/api";
import { spotify } from "@/lib/spotify";

export const dynamic = "force-dynamic";

/** The user's own playlists (for the room's music picker). */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const r = await spotify(g.user.id, "/me/playlists?limit=30").catch(() => null);
  if (!r?.ok) return Response.json({ items: [] });
  const d = (await r.json()) as { items: { id: string; name: string; uri: string; external_urls?: { spotify?: string }; images?: { url: string }[] | null; tracks?: { total: number } }[] };
  return Response.json({
    items: d.items.map((p) => ({ id: p.id, name: p.name, uri: p.uri, url: p.external_urls?.spotify ?? null, image: p.images?.at(-1)?.url ?? null, tracks: p.tracks?.total ?? 0 })),
  });
}
