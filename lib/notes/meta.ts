import { htmlToText, stripInvisible, truncate } from "@/lib/security/sanitize";
import { hostOf } from "./text";

/**
 * Title and description from a page's <head>, for bookmarks. The result is
 * UNTRUSTED plain text: entities decoded, tags and invisible characters
 * removed, length capped. It is never rendered as HTML or Markdown.
 */

const NAMED: Record<string, string> = { apos: "'", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", ndash: "–", mdash: "-" };

function fromCode(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : " ";
}

function clean(raw: string): string {
  const decoded = htmlToText(raw)
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => fromCode(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, d: string) => fromCode(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m);
  return stripInvisible(decoded)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

export function parseLinkMeta(html: string, pageUrl: string): { title: string; description: string | null } {
  const capped = html.slice(0, 200_000);
  const head = (/<head\b[\s\S]*?<\/head\s*>/i.exec(capped)?.[0] ?? capped).replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ");

  const meta = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    const key = (a.property ?? a.name ?? "").toLowerCase();
    if (key && a.content !== undefined && !meta.has(key)) meta.set(key, a.content);
  }
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = clean(meta.get(k) ?? "");
      if (v) return v;
    }
    return "";
  };

  const titleTag = clean(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1] ?? "");
  const title = pick("og:title", "twitter:title") || titleTag || hostOf(pageUrl);
  const description = pick("description", "og:description", "twitter:description");
  return { title: truncate(title, 200), description: description ? truncate(description, 500) : null };
}
