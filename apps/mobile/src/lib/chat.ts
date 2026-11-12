import { fetch } from "expo/fetch";
import { ApiError, authHeaders, reportGate, reportUnauthorized } from "./api";
import { API_URL } from "./config";
import { NdjsonParser } from "./ndjson";
import type { ChatEvent } from "./types";

export type SendInput = {
  conversationId?: string;
  message: string;
  trigger: "text" | "voice";
  /** Regenerate: replace this user message and everything after it. */
  replaceFromMessageId?: string;
};

/**
 * Streams one assistant turn from POST /api/chat (the same pipeline as the web: memory, sources,
 * proposals). Events arrive as they are produced; abort the signal to stop generation.
 */
export async function streamChat(input: SendInput, onEvent: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${API_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", ...authHeaders() },
      body: JSON.stringify(input),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError(0, "You're offline. Check your connection and try again.");
  }
  if (res.status === 401) {
    reportUnauthorized();
    throw new ApiError(401, "Your session ended. Sign in again.");
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    reportGate(res.status, body);
    const msg = res.status === 429 ? "You're sending messages quickly. Wait a moment." : res.status === 401 ? "Your session ended. Sign in again." : (body?.message ?? "Couldn't reach your agent. Try again.");
    throw new ApiError(res.status, msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new NdjsonParser<ChatEvent>();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const e of parser.push(decoder.decode(value, { stream: true }))) onEvent(e);
  }
  for (const e of parser.flush()) onEvent(e);
}
