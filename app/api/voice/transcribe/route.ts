import { restrictedResponse } from "@/lib/admin/restrictions";
import { capabilityOffResponse } from "@/lib/ai/gate";
import { apiGuard } from "@/lib/auth/api";
import { getConfigValue } from "@/lib/config/store";
import { cappedLimit } from "@/lib/config/uploads";
import { env } from "@/lib/env";
import { errMessage, log } from "@/lib/log";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Short recordings only: stays well under Vercel's request body limit (and under uploads.maxMb). */
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

/**
 * Speech-to-text through an OpenAI-compatible transcription endpoint serving an
 * open-source Whisper model (e.g. Groq or Together). Audio is not stored.
 */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const restricted = await restrictedResponse(g.user.id, "ai");
  if (restricted) return restricted;
  const off = await capabilityOffResponse("voice");
  if (off) return off;
  const rl = await rateLimit("ai", `stt:${g.user.id}`);
  if (!rl.success) return rateLimitResponse(rl);
  const e = env();
  if (!e.STT_BASE_URL) return errorJson(501, "Server transcription isn't configured.");
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File)) return errorJson(400, "No audio received.");
  if (audio.size > cappedLimit(MAX_AUDIO_BYTES, await getConfigValue("uploads.maxMb"))) return errorJson(413, "Recording is too long. Keep it under a minute.");
  if (!/^audio\//.test(audio.type)) return errorJson(415, "Unsupported audio format.");

  const upstream = new FormData();
  upstream.set("file", audio, audio.name || "speech.webm");
  upstream.set("model", e.STT_MODEL ?? "whisper-large-v3");
  upstream.set("response_format", "json");
  try {
    const res = await fetch(`${e.STT_BASE_URL.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: e.STT_API_KEY ? { authorization: `Bearer ${e.STT_API_KEY}` } : {},
      body: upstream,
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`STT ${res.status}`);
    const data = (await res.json()) as { text?: string };
    return Response.json({ text: (data.text ?? "").trim().slice(0, 4000) });
  } catch (err) {
    log.warn("voice.stt_failed", { error: errMessage(err) });
    return errorJson(502, "Transcription failed. Try again.");
  }
}
