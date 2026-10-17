import "server-only";
import { oauthAccessToken } from "@/lib/integrations/oauth";

/** Spotify Web API calls on behalf of a user who connected Spotify (tokens refresh automatically). */
export async function spotify(userId: string, path: string, init: RequestInit = {}): Promise<Response> {
  const { token } = await oauthAccessToken(userId, "spotify");
  return fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(8000),
  });
}

export type NowPlaying = {
  playing: boolean;
  track: string;
  artists: string;
  album: string;
  image: string | null;
  url: string | null;
  progressMs: number;
  durationMs: number;
  device: string | null;
} | null;

export async function nowPlaying(userId: string): Promise<NowPlaying> {
  const r = await spotify(userId, "/me/player?additional_types=track,episode");
  if (r.status === 204 || !r.ok) return null; // nothing playing on any device
  const d = (await r.json()) as {
    is_playing: boolean;
    progress_ms: number | null;
    device?: { name?: string };
    item?: { name: string; duration_ms: number; external_urls?: { spotify?: string }; artists?: { name: string }[]; album?: { name: string; images?: { url: string; width: number }[] }; show?: { name: string; images?: { url: string }[] } } | null;
  };
  if (!d.item) return null;
  const images = d.item.album?.images ?? d.item.show?.images ?? [];
  const img = images.find((i) => (("width" in i ? (i as { width: number }).width : 300) ?? 300) <= 320) ?? images[0];
  return {
    playing: d.is_playing,
    track: d.item.name,
    artists: (d.item.artists ?? []).map((a) => a.name).join(", ") || d.item.show?.name || "",
    album: d.item.album?.name ?? d.item.show?.name ?? "",
    image: img?.url && img.url.startsWith("https://") ? img.url : null,
    url: d.item.external_urls?.spotify ?? null,
    progressMs: d.progress_ms ?? 0,
    durationMs: d.item.duration_ms,
    device: d.device?.name ?? null,
  };
}
