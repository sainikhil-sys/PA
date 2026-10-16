import { z } from "zod";
import { runChatTurn, type ChatEvent } from "@/lib/agent/chat";
import { apiGuard } from "@/lib/auth/api";
import { errMessage, log } from "@/lib/log";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(8000),
  trigger: z.enum(["text", "voice"]).default("text"),
  attachment: z.object({ name: z.string().max(200), text: z.string().max(60_000) }).optional(),
  replaceFromMessageId: z.string().uuid().optional(),
});

/** Streams newline-delimited JSON events (meta, tool, citations, text, proposal, done). */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const rl = await rateLimit("ai", `chat:${g.user.id}`);
  if (!rl.success) return rateLimitResponse(rl);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson(400, "invalid_request");

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      try {
        for await (const ev of runChatTurn({ user: g.user, ...parsed.data })) send(ev);
      } catch (err) {
        log.error("chat.failed", { error: errMessage(err) });
        send({ type: "error", message: "Something went wrong. Please try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
