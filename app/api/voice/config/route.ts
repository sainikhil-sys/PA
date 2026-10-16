import { apiGuard } from "@/lib/auth/api";
import { getSettings } from "@/lib/db/queries/settings";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Voice preferences + which server endpoints exist (no secrets). */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const s = await getSettings(g.user.id);
  const e = env();
  return Response.json({
    voice: s.agent.voice,
    speechRate: s.agent.speechRate,
    language: s.agent.language,
    agentName: s.agent.name,
    serverStt: Boolean(e.STT_BASE_URL),
    serverTts: Boolean(e.TTS_BASE_URL),
  });
}
