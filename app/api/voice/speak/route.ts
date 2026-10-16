import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { env } from "@/lib/env";
import { errMessage, log } from "@/lib/log";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({ text: z.string().trim().min(1).max(1200), voice: z.string().max(60).optional(), speed: z.number().min(0.5).max(2).optional() });

/** Optional open-source TTS (e.g. Kokoro/Piper behind an OpenAI-compatible /audio/speech). */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const rl = await rateLimit("ai", `tts:${g.user.id}`);
  if (!rl.success) return rateLimitResponse(rl);
  const e = env();
  if (!e.TTS_BASE_URL) return errorJson(501, "Server speech isn't configured.");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson(400, "invalid_request");
  try {
    const res = await fetch(`${e.TTS_BASE_URL.replace(/\/$/, "")}/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(e.TTS_API_KEY ? { authorization: `Bearer ${e.TTS_API_KEY}` } : {}) },
      body: JSON.stringify({ model: e.TTS_MODEL ?? "kokoro", voice: parsed.data.voice || e.TTS_VOICE || "af_heart", input: parsed.data.text, speed: parsed.data.speed ?? 1, response_format: "mp3" }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok || !res.body) throw new Error(`TTS ${res.status}`);
    return new Response(res.body, { headers: { "content-type": res.headers.get("content-type") ?? "audio/mpeg", "cache-control": "no-store" } });
  } catch (err) {
    log.warn("voice.tts_failed", { error: errMessage(err) });
    return errorJson(502, "Speech failed.");
  }
}
