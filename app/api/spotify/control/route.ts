import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { spotify } from "@/lib/spotify";

export const dynamic = "force-dynamic";

const body = z.object({ action: z.enum(["play", "pause", "next", "previous"]), contextUri: z.string().regex(/^spotify:(playlist|album|artist):[A-Za-z0-9]{10,40}$/).optional() });

/** Play / pause / skip on the user's active Spotify device. Spotify only allows this on Premium. */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { action, contextUri } = parsed.data;
  const r =
    action === "play"
      ? await spotify(g.user.id, "/me/player/play", { method: "PUT", body: contextUri ? JSON.stringify({ context_uri: contextUri }) : undefined })
      : action === "pause"
        ? await spotify(g.user.id, "/me/player/pause", { method: "PUT" })
        : await spotify(g.user.id, `/me/player/${action}`, { method: "POST" });
  if (r.ok || r.status === 204) return Response.json({ ok: true });
  const reason = r.status === 404 ? "Open Spotify on a phone, computer or speaker first, then try again." : r.status === 403 ? "Spotify only allows playback control with Spotify Premium." : `Spotify returned ${r.status}.`;
  return Response.json({ error: reason }, { status: r.status === 404 || r.status === 403 ? r.status : 502 });
}
