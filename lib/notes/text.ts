import { truncate } from "@/lib/security/sanitize";

/**
 * Pure helpers for notes and bookmarks. No "server-only" and no db imports:
 * the editor uses normalizeTags on the client and the unit tests import this directly.
 */

const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u;
const MAX_TAGS = 12;
const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];

/** "#Pricing, ideas" or ["Pricing", "#ideas"] -> ["pricing", "ideas"]. Invalid tags are dropped, max 12. */
export function normalizeTags(input: string | string[]): string[] {
  const parts = typeof input === "string" ? input.split(/[\s,]+/) : input.flatMap((t) => t.split(/[\s,]+/));
  const out: string[] = [];
  for (const raw of parts) {
    const tag = raw.trim().replace(/^#+/, "").toLowerCase();
    if (!TAG_RE.test(tag) || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** http(s) only, no credentials, tracking params removed. "example.com/a" becomes "https://example.com/a". */
export function normalizeBookmarkUrl(raw: string): string | null {
  let value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]|$)/i.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || !url.hostname) return null;
  for (const p of TRACKING_PARAMS) url.searchParams.delete(p);
  return url.toString();
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 80);
  }
}

/** ILIKE patterns, one per word (max 6), with % _ and \ escaped. */
export function searchTerms(q: string): string[] {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((t) => `%${t.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
}

/** The text mirrored into the knowledge base. Deterministic, so unchanged notes hash the same. */
export function noteIndexText(n: { title: string; content: string; url: string | null; linkDescription: string | null; tags: string[] }): string {
  const text = [
    n.url ? `Link: ${n.url}` : "",
    n.linkDescription ? `Page description (from the web): ${n.linkDescription}` : "",
    n.tags.length ? `Tags: ${n.tags.map((t) => `#${t}`).join(" ")}` : "",
    n.content.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  return text || n.title;
}

/** Markdown to a short plain-text preview for cards. */
export function plainExcerpt(md: string, max = 280): string {
  const text = md
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/`/g, "")
    .replace(/[*~]+/g, "")
    .replace(/\b_+|_+\b/g, "");
  return truncate(text, max);
}
