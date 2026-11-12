import "server-only";
import { embed, generateText, streamText } from "ai";
import type { z } from "zod";
import { env } from "@/lib/env";
import { errMessage, log } from "@/lib/log";
import { db, schema } from "@/lib/db";
import { EMBEDDING_DIMENSIONS } from "@/lib/db/schema";
import { AiLimitError, dailyLimitReached } from "./gate";
import { configuredProviders, modelFor, providerClient, type ModelTier, type ProviderConfig } from "./providers";
import { generateStructured, type ChatMessage } from "./structured";
import { userProvider } from "./user-provider";

export class NoProviderError extends Error {
  constructor() {
    super("No AI provider configured. Set AI_BASE_URL, AI_API_KEY, FAST_MODEL and SMART_MODEL.");
  }
}

type RunMeta = { kind: string; userId?: string | null };
type Usage = { inputTokens?: number; outputTokens?: number } | undefined;

/**
 * The user's own key first (if they added one), then Cowork's server providers. Once the person has
 * used today's allowance (ai.dailyTokenLimitPerUser), only their own key is left; with no own key the
 * call is refused with AiLimitError. Calls without a person are never limited.
 */
async function providersFor(meta: RunMeta): Promise<ProviderConfig[]> {
  const own = await userProvider(meta.userId).catch(() => null);
  const server = configuredProviders();
  if (server.length && (await dailyLimitReached(meta.userId))) {
    if (!own) throw new AiLimitError();
    return [own];
  }
  return own ? [own, ...server] : server;
}

async function recordRun(meta: RunMeta, p: ProviderConfig, model: string, ok: boolean, attempts: number, started: number, errorCode?: string, usage?: Usage) {
  const durationMs = Date.now() - started;
  // Log which model handled the task — never prompts or outputs.
  log.info("ai.run", { kind: meta.kind, provider: p.name, model, ok, attempts, durationMs, errorCode });
  try {
    await db().insert(schema.aiRuns).values({
      userId: meta.userId ?? null,
      taskKind: meta.kind,
      provider: p.name,
      model,
      ok,
      attempts,
      durationMs,
      errorCode: errorCode?.slice(0, 120),
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      keySource: p.name === "own" ? "own" : "server",
    });
  } catch {
    // Observability must never break the task.
  }
}

/** Try each provider in order until one succeeds. */
async function withFallback<T>(
  meta: RunMeta,
  tier: ModelTier,
  fn: (p: ProviderConfig, modelId: string, model: ReturnType<typeof modelFor>["model"], usage: { in: number; out: number }) => Promise<{ value: T; attempts: number }>,
): Promise<{ value: T; provider: string; model: string }> {
  const providers = await providersFor(meta);
  if (providers.length === 0) throw new NoProviderError();
  let lastErr: unknown;
  for (const p of providers) {
    const { id, model } = modelFor(p, tier);
    const started = Date.now();
    const usage = { in: 0, out: 0 };
    try {
      const { value, attempts } = await fn(p, id, model, usage);
      await recordRun(meta, p, id, true, attempts, started, undefined, { inputTokens: usage.in, outputTokens: usage.out });
      return { value, provider: p.name, model: id };
    } catch (err) {
      lastErr = err;
      await recordRun(meta, p, id, false, 1, started, err instanceof Error ? err.name : "error", { inputTokens: usage.in, outputTokens: usage.out });
      log.warn("ai.provider_failed", { kind: meta.kind, provider: p.name, model: id, error: errMessage(err) });
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All AI providers failed");
}

/** House style applied to every prompt: user-facing text never contains em or en dashes. */
const STYLE = "Never use em dashes or en dashes in your output. Use a comma, colon, period or parentheses instead.";

async function chat(model: ReturnType<typeof modelFor>["model"], system: string, messages: ChatMessage[], temperature: number, usage?: { in: number; out: number }) {
  const { text, usage: u } = await generateText({
    model,
    system: `${system}\n\n${STYLE}`,
    messages,
    temperature,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(env().AI_TIMEOUT_MS),
  });
  if (usage) {
    usage.in += u?.inputTokens ?? 0;
    usage.out += u?.outputTokens ?? 0;
  }
  return text;
}

/** Free-text generation (drafts, briefings). */
export async function generate(opts: RunMeta & { tier: ModelTier; system: string; prompt: string; temperature?: number }) {
  return withFallback(opts, opts.tier, async (_p, _id, model, usage) => ({
    value: await chat(model, opts.system, [{ role: "user", content: opts.prompt }], opts.temperature ?? 0.4, usage),
    attempts: 1,
  }));
}

/** Schema-validated structured output with retry-on-invalid, per provider. */
export async function generateObject<T extends z.ZodType>(
  opts: RunMeta & { tier: ModelTier; system: string; prompt: string; schema: T; temperature?: number },
) {
  return withFallback(opts, opts.tier, async (_p, _id, model, usage) => {
    const { data, attempts } = await generateStructured({
      schema: opts.schema,
      prompt: opts.prompt,
      generate: (messages) => chat(model, opts.system, messages, opts.temperature ?? 0.1, usage),
    });
    return { value: data as z.infer<T>, attempts };
  });
}

/**
 * Streaming generation with fallback: if a provider fails before emitting its
 * first token, the next provider is tried. After the first token, errors propagate.
 */
export async function* streamGenerate(
  opts: RunMeta & { tier: ModelTier; system: string; messages: ChatMessage[]; temperature?: number },
): AsyncGenerator<{ type: "model"; provider: string; model: string } | { type: "text"; delta: string }> {
  const providers = await providersFor(opts);
  if (providers.length === 0) throw new NoProviderError();
  let lastErr: unknown;
  for (const p of providers) {
    const { id, model } = modelFor(p, opts.tier);
    const started = Date.now();
    let emitted = false;
    try {
      const result = streamText({
        model,
        system: `${opts.system}\n\n${STYLE}`,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.4,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(env().AI_TIMEOUT_MS * 2),
      });
      for await (const delta of result.textStream) {
        if (!emitted) {
          emitted = true;
          yield { type: "model", provider: p.name, model: id };
        }
        yield { type: "text", delta };
      }
      if (!emitted) throw new Error("Empty response");
      const u = await Promise.resolve(result.usage).catch(() => undefined);
      await recordRun(opts, p, id, true, 1, started, undefined, { inputTokens: u?.inputTokens, outputTokens: u?.outputTokens });
      return;
    } catch (err) {
      lastErr = err;
      await recordRun(opts, p, id, false, 1, started, err instanceof Error ? err.name : "error");
      if (emitted) throw err;
      log.warn("ai.stream_failed", { kind: opts.kind, provider: p.name, model: id, error: errMessage(err) });
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All AI providers failed");
}

/** Embeddings through the same OpenAI-compatible endpoint. Returns null if not configured. */
export async function embedText(text: string, meta: RunMeta): Promise<number[] | null> {
  const p = configuredProviders().find((x) => x.embeddingModel);
  if (!p?.embeddingModel) return null;
  // Over the daily limit: callers already handle "no embedding" (keyword search instead).
  if (await dailyLimitReached(meta.userId)) return null;
  const started = Date.now();
  try {
    const { embedding, usage } = await embed({
      model: providerClient(p).embeddingModel(p.embeddingModel),
      value: text.slice(0, 8000),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(20_000),
    });
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding has ${embedding.length} dims; schema expects ${EMBEDDING_DIMENSIONS}`);
    }
    await recordRun(meta, p, p.embeddingModel, true, 1, started, undefined, { inputTokens: usage?.tokens });
    return embedding;
  } catch (err) {
    await recordRun(meta, p, p.embeddingModel, false, 1, started, err instanceof Error ? err.name : "error");
    log.warn("ai.embed_failed", { error: errMessage(err) });
    return null;
  }
}

/** Settings page: ping a provider with a tiny prompt. */
export async function testProvider(name: string): Promise<{ ok: boolean; model?: string; latencyMs?: number; error?: string }> {
  const p = configuredProviders().find((x) => x.name === name);
  if (!p) return { ok: false, error: "Provider not configured" };
  const { id, model } = modelFor(p, "fast");
  const started = Date.now();
  try {
    await generateText({ model, prompt: "Reply with the single word: ok", maxRetries: 0, abortSignal: AbortSignal.timeout(15_000) });
    return { ok: true, model: id, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, model: id, error: errMessage(err).slice(0, 200) };
  }
}
