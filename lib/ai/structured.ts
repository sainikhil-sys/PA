import type { z } from "zod";

/**
 * Open-weight models are unreliable at strict JSON. We ask for JSON in plain
 * text, extract the first JSON value, validate with zod, and on failure retry
 * with the validation error fed back (max 2 retries).
 */
export const MAX_STRUCTURED_RETRIES = 2;

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/** Extract the first balanced JSON object/array from model text (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in model output");
  const open = candidate[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(candidate.slice(start, i + 1));
  }
  throw new Error("Unterminated JSON in model output");
}

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type Generate = (messages: ChatMessage[]) => Promise<string>;

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

export async function generateStructured<T extends z.ZodType>(opts: {
  schema: T;
  prompt: string;
  generate: Generate;
  maxRetries?: number;
}): Promise<{ data: z.infer<T>; attempts: number }> {
  const maxRetries = opts.maxRetries ?? MAX_STRUCTURED_RETRIES;
  const messages: ChatMessage[] = [{ role: "user", content: opts.prompt }];
  let lastError = "unknown";
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const text = await opts.generate(messages);
    let parsed: unknown;
    try {
      parsed = extractJson(text);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "invalid JSON";
      messages.push({ role: "assistant", content: text.slice(0, 2000) });
      messages.push({ role: "user", content: `That was not valid JSON (${lastError}). Reply with ONLY the JSON object, no prose.` });
      continue;
    }
    const result = opts.schema.safeParse(parsed);
    if (result.success) return { data: result.data, attempts: attempt };
    lastError = formatZodError(result.error);
    messages.push({ role: "assistant", content: text.slice(0, 2000) });
    messages.push({
      role: "user",
      content: `The JSON did not match the required schema:\n${lastError}\nReply with ONLY the corrected JSON object.`,
    });
  }
  throw new StructuredOutputError(`Structured output failed validation: ${lastError}`, maxRetries + 1);
}
