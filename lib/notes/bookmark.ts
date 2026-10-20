import "server-only";
import { safeFetch } from "@/lib/security/safe-fetch";
import { parseLinkMeta } from "./meta";
import { hostOf } from "./text";

const MAX_BYTES = 512 * 1024;
const PASS_THROUGH = ["Private addresses are not allowed", "Only http(s) URLs are supported", "Too many redirects", "URLs with credentials are not allowed"];

/** Read at most `bytes` of the body, then stop downloading. */
async function readCapped(res: Response, bytes: number): Promise<string> {
  const type = res.headers.get("content-type") ?? "";
  const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset, { fatal: false });
  } catch {
    decoder = new TextDecoder("utf-8", { fatal: false });
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  let out = "";
  let read = 0;
  while (read < bytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value.byteLength + read > bytes ? value.subarray(0, bytes - read) : value;
    read += chunk.byteLength;
    out += decoder.decode(chunk, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return out + decoder.decode();
}

/**
 * Fetch a page's title and description for a bookmark. Only safeFetch is used
 * (public hosts on every redirect hop). No model sees the result here, so
 * nothing on the page can trigger an action. Throws short, human messages.
 */
export async function fetchLinkPreview(url: string): Promise<{ title: string; description: string | null }> {
  try {
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "Cowork-notes/1.0", accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`The page returned ${res.status}`);
    }
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
      // A PDF or image link is still a valid bookmark; it just has no page details.
      await res.body?.cancel().catch(() => undefined);
      return { title: hostOf(url), description: null };
    }
    return parseLinkMeta(await readCapped(res, MAX_BYTES), url);
  } catch (err) {
    throw new Error(linkErrorMessage(err));
  }
}

export function linkErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "The page took too long to respond";
    if (PASS_THROUGH.includes(err.message) || /^The page returned \d{3}$/.test(err.message)) return err.message;
  }
  return "Couldn't reach that page";
}
