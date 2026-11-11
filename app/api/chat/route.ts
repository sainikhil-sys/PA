import { z } from "zod";
import { runChatTurn, type ChatEvent } from "@/lib/agent/chat";
import { apiGuard } from "@/lib/auth/api";
import { ATTACHMENT_KINDS, MAX_ATTACHMENT_CHARS, MAX_MESSAGE_CHARS, TRANSFORM_KINDS, TRANSLATE_LANGUAGES } from "@/lib/chat/attachments";
import { errMessage, log } from "@/lib/log";
import { rateLimit, rateLimitResponse } from "@/lib/security/ratelimit";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
    trigger: z.enum(["text", "voice"]).default("text"),
    attachment: z.object({ name: z.string().max(200), text: z.string().max(MAX_ATTACHMENT_CHARS), kind: z.enum(ATTACHMENT_KINDS).default("txt") }).optional(),
    /** Quick action on the attachment: skips planning and tools, so nothing can be proposed. */
    transform: z
      .object({ kind: z.enum(TRANSFORM_KINDS), language: z.enum(TRANSLATE_LANGUAGES).optional() })
      .refine((t) => t.kind !== "translate" || !!t.language)
      .optional(),
    replaceFromMessageId: z.string().uuid().optional(),
  })
  .refine((b) => !b.transform || !!b.attachment);

/** Streams newline-delimited JSON events (meta, tool, citations, text, proposal, done). */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const rl = await rateLimit("ai", `chat:${g.user.id}`);
  if (!rl.success) return rateLimitResponse(rl);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorJson(400, "invalid_request");

  const enc = new TextEncoder();
  // Stop on the client closes the connection. The turn then ends early but still saves what was written
  // so far (marked stopped), so reopening the chat shows the partial answer, not a bare question.
  const stop = new AbortController();
  req.signal.addEventListener("abort", () => stop.abort(), { once: true });
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ChatEvent) => {
        if (stop.signal.aborted) return;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
        } catch {
          stop.abort();
        }
      };
      try {
        for await (const ev of runChatTurn({ user: g.user, ...parsed.data, signal: stop.signal })) send(ev);
      } catch (err) {
        log.error("chat.failed", { error: errMessage(err) });
        send({ type: "error", message: "Something went wrong. Please try again." });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      }
    },
    cancel() {
      stop.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
