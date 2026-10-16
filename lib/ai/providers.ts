import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env, isOnVercel } from "@/lib/env";

export type ModelTier = "fast" | "smart";

export type ProviderConfig = {
  name: string;
  baseURL: string;
  apiKey?: string;
  fastModel: string;
  smartModel: string;
  embeddingModel?: string;
};

/**
 * Ordered list of OpenAI-compatible providers, configured only by env vars.
 * 1. Primary (AI_*)   2. Fallback (AI_FALLBACK_*)   3. Ollama (local dev only, never on Vercel)
 */
export function configuredProviders(): ProviderConfig[] {
  const e = env();
  const list: ProviderConfig[] = [];
  if (e.AI_BASE_URL && (e.FAST_MODEL || e.SMART_MODEL)) {
    list.push({
      name: "primary",
      baseURL: e.AI_BASE_URL,
      apiKey: e.AI_API_KEY,
      fastModel: e.FAST_MODEL ?? e.SMART_MODEL!,
      smartModel: e.SMART_MODEL ?? e.FAST_MODEL!,
      embeddingModel: e.EMBEDDING_MODEL,
    });
  }
  if (e.AI_FALLBACK_BASE_URL && (e.AI_FALLBACK_FAST_MODEL || e.AI_FALLBACK_SMART_MODEL)) {
    list.push({
      name: "fallback",
      baseURL: e.AI_FALLBACK_BASE_URL,
      apiKey: e.AI_FALLBACK_API_KEY,
      fastModel: e.AI_FALLBACK_FAST_MODEL ?? e.AI_FALLBACK_SMART_MODEL!,
      smartModel: e.AI_FALLBACK_SMART_MODEL ?? e.AI_FALLBACK_FAST_MODEL!,
    });
  }
  if (e.OLLAMA_BASE_URL && !isOnVercel()) {
    const model = e.OLLAMA_MODEL ?? "llama3.1";
    list.push({ name: "ollama", baseURL: e.OLLAMA_BASE_URL.replace(/\/$/, "") + "/v1", fastModel: model, smartModel: model });
  }
  return list;
}

const cache = new Map<string, ReturnType<typeof createOpenAICompatible>>();

export function providerClient(p: ProviderConfig) {
  const key = `${p.name}|${p.baseURL}`;
  let client = cache.get(key);
  if (!client) {
    client = createOpenAICompatible({ name: p.name, baseURL: p.baseURL, apiKey: p.apiKey });
    cache.set(key, client);
  }
  return client;
}

export function modelFor(p: ProviderConfig, tier: ModelTier) {
  const id = tier === "fast" ? p.fastModel : p.smartModel;
  return { id, model: providerClient(p).chatModel(id) };
}
