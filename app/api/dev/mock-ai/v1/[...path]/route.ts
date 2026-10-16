import { isTestMode } from "@/lib/env";

/**
 * Deterministic OpenAI-compatible mock used ONLY by the Playwright smoke run
 * (OTP_TEST_MODE=true). Returns 404 everywhere else, and test mode is refused
 * on Vercel production. Lets tests exercise the real provider code path.
 */
export const dynamic = "force-dynamic";

type ChatBody = { messages?: { role: string; content: unknown }[]; stream?: boolean };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "object" && p && "text" in p ? String(p.text) : "")).join("");
  return "";
}

function reply(prompt: string): string {
  if (/"sources"/.test(prompt) && /JSON/.test(prompt)) {
    return JSON.stringify({ sources: ["tasks"], search_query: "", actions: [] });
  }
  if (/"category"/.test(prompt)) return JSON.stringify({ category: "FYI", summary: "Test email summary.", priority: 2, action_required: false });
  if (/"intent"/.test(prompt)) return JSON.stringify({ intent: "question", needs_confirmation: false });
  if (/"headline"/.test(prompt)) return JSON.stringify({ headline: "A calm test day.", summary: "Nothing urgent.", priorities: ["Review tasks"] });
  if (/"ideas"/.test(prompt)) return JSON.stringify({ ideas: [{ title: "Test idea", hook: "A short test hook." }] });
  return "Hello from the test model. Everything is working.";
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!isTestMode()) return new Response("Not found", { status: 404 });
  const path = (await ctx.params).path.join("/");

  if (path === "embeddings") {
    return Response.json({ data: [{ index: 0, embedding: Array.from({ length: 1024 }, (_, i) => (i % 7) / 7) }], usage: { prompt_tokens: 1, total_tokens: 1 } });
  }
  if (path !== "chat/completions") return new Response("Not found", { status: 404 });

  const body = (await req.json()) as ChatBody;
  const last = textOf(body.messages?.filter((m) => m.role === "user").at(-1)?.content);
  const text = reply(last);
  const base = { id: "mock-1", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: "mock" };

  if (!body.stream) {
    return Response.json({
      ...base,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
  }
  const enc = new TextEncoder();
  const words = text.split(/(?<= )/);
  const stream = new ReadableStream({
    start(controller) {
      for (const w of words) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: w }, finish_reason: null }] })}\n\n`));
      }
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}
