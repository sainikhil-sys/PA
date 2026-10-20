import "server-only";
import { env } from "@/lib/env";
import { errMessage, log } from "@/lib/log";
import { parseTavilyResults, type WebResult } from "./results";

/**
 * Server-side web search (Tavily). Results are UNTRUSTED third-party text:
 * callers wrap them in <source_content> and cite them, never follow them.
 * This module never fetches result URLs; any future page read must go through
 * safeFetch or lib/knowledge/extract.ts fetchPageText.
 */

const TAVILY_URL = "https://api.tavily.com/search";

export type { WebResult } from "./results";

export class WebSearchNotConfiguredError extends Error {
  constructor() {
    super("Web search is not configured");
  }
}

export class WebSearchError extends Error {
  constructor(readonly reason: "rejected" | "rate_limited" | "unavailable") {
    super(`Web search ${reason}`);
  }
}

export function webSearchConfigured(): boolean {
  return Boolean(env().TAVILY_API_KEY);
}

export async function searchWeb(query: string, opts: { maxResults?: number } = {}): Promise<WebResult[]> {
  const key = env().TAVILY_API_KEY;
  if (!key) throw new WebSearchNotConfiguredError();
  const q = query.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!q) return [];
  const max = Math.max(1, Math.min(opts.maxResults ?? 5, 8));

  let res: Response;
  try {
    // Fixed provider endpoint (never a user or content URL), so a plain fetch is correct here.
    res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query: q,
        search_depth: "basic",
        topic: "general",
        max_results: max,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (err) {
    log.warn("web.search_failed", { error: errMessage(err) });
    throw new WebSearchError("unavailable");
  }

  if (!res.ok) {
    log.warn("web.search_status", { status: res.status });
    if (res.status === 401 || res.status === 403) throw new WebSearchError("rejected");
    if (res.status === 429 || res.status === 432 || res.status === 433) throw new WebSearchError("rate_limited");
    throw new WebSearchError("unavailable");
  }
  return parseTavilyResults(await res.json().catch(() => null), max);
}
