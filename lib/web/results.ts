import { stripInvisible } from "@/lib/security/sanitize";

/** One web search hit. Every field is untrusted third-party text. */
export type WebResult = { title: string; url: string; host: string; snippet: string; publishedDate?: string };

function clean(value: unknown, max: number): string {
  return stripInvisible(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Turn a Tavily /search response into a short list of safe results: only
 * http(s) URLs without credentials, no #fragment, deduped. Never reads
 * `raw_content` or the provider's own `answer`.
 */
export function parseTavilyResults(data: unknown, max = 5): WebResult[] {
  const raw = (data as { results?: unknown } | null | undefined)?.results;
  if (!Array.isArray(raw)) return [];
  const out: WebResult[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as { title?: unknown; url?: unknown; content?: unknown; published_date?: unknown };
    let url: URL;
    try {
      url = new URL(String(r.url));
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.username || url.password) continue;
    url.hash = "";
    const href = url.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    const host = url.hostname.replace(/^www\./, "");
    const result: WebResult = { title: clean(r.title, 180) || host, url: href, host, snippet: clean(r.content, 600) };
    if (typeof r.published_date === "string" && r.published_date) result.publishedDate = r.published_date.slice(0, 32);
    out.push(result);
    if (out.length >= max) break;
  }
  return out;
}
