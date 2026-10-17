import { XMLParser } from "fast-xml-parser";
import { htmlToText, stripInvisible, truncate } from "@/lib/security/sanitize";

/** Pure feed parsing (RSS 2.0 + Atom). Output is short metadata only — never full articles. */

export type FeedSource = { name: string; url: string; category: string };
export type ParsedItem = { url: string; title: string; summary: string; imageUrl?: string; publishedAt: Date; sourceName: string; category: string };

/** Lead image: media:content / media:thumbnail / image enclosure / first <img> in the HTML. https only. */
export function feedImage(it: Record<string, any>): string | undefined { // eslint-disable-line @typescript-eslint/no-explicit-any
  const arr = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []) as Record<string, string>[];
  const candidates: (string | undefined)[] = [
    ...arr(it["media:content"]).filter((m) => !m["@_medium"] || m["@_medium"] === "image" || /image/.test(m["@_type"] ?? "")).map((m) => m["@_url"]),
    ...arr(it["media:group"]).flatMap((g) => arr((g as Record<string, unknown>)["media:content"]).map((m) => m["@_url"])),
    ...arr(it["media:thumbnail"]).map((m) => m["@_url"]),
    ...arr(it.enclosure).filter((e) => /^image//.test(e["@_type"] ?? "")).map((e) => e["@_url"]),
  ];
  const html = [it["content:encoded"], it.description, it.content, it.summary].map((v) => (typeof v === "string" ? v : typeof v === "object" && v ? String((v as Record<string, unknown>)["#text"] ?? "") : "")).join(" ");
  candidates.push(/<img[^>]+src=["'](https:[^"']+)["']/i.exec(html)?.[1]);
  const hit = candidates.find((u) => typeof u === "string" && /^https://[^s]+$/.test(u) && u.length < 1000);
  return hit?.replace(/&amp;/g, "&");
}

export const DEFAULT_FEEDS: FeedSource[] = [
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", category: "world" },
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", category: "world" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "world" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "technology" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "technology" },
  { name: "Hacker News", url: "https://hnrss.org/frontpage", category: "technology" },
  { name: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", category: "business" },
  { name: "BBC Science", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", category: "science" },
];

export const NEWS_TOPICS = ["world", "technology", "business", "science", "ai", "design", "health", "sports"];

/** NEWS_FEEDS="Name|https://feed|category;Name|https://feed|category" overrides the defaults. */
export function parseFeedConfig(raw: string | undefined): FeedSource[] {
  if (!raw?.trim()) return DEFAULT_FEEDS;
  const feeds = raw
    .split(";")
    .map((part) => part.split("|").map((s) => s.trim()))
    .filter((p): p is [string, string, string] => p.length >= 3 && /^https:\/\//.test(p[1] ?? ""))
    .map(([name, url, category]) => ({ name, url, category: category.toLowerCase() }));
  return feeds.length ? feeds : DEFAULT_FEEDS;
}

/** Strip tracking params and fragments so the same story dedupes across feeds. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|cmpid|at_)/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", processEntities: true, htmlEntities: true });

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"] ?? "");
  return "";
}

function clean(s: string, max: number): string {
  return truncate(stripInvisible(htmlToText(s)), max);
}

export function parseFeed(xml: string, source: FeedSource, limit = 15): ParsedItem[] {
  const doc = parser.parse(xml) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: ParsedItem[] = [];
  const rssItems = doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item;
  const atomEntries = doc?.feed?.entry;
  const items: any[] = Array.isArray(rssItems) ? rssItems : rssItems ? [rssItems] : Array.isArray(atomEntries) ? atomEntries : atomEntries ? [atomEntries] : []; // eslint-disable-line @typescript-eslint/no-explicit-any

  for (const it of items.slice(0, limit)) {
    const title = clean(text(it.title), 180);
    let link = text(it.link);
    if (!link && it.link) {
      const links = Array.isArray(it.link) ? it.link : [it.link];
      link = links.find((l: Record<string, string>) => !l["@_rel"] || l["@_rel"] === "alternate")?.["@_href"] ?? "";
    }
    if (!link && typeof it.guid === "string" && /^https?:/.test(it.guid)) link = it.guid;
    if (!title || !/^https?:\/\//.test(link)) continue;
    const summary = clean(text(it.description) || text(it.summary) || text(it["content:encoded"]) || text(it.content), 200);
    const dateRaw = text(it.pubDate) || text(it.published) || text(it.updated) || text(it["dc:date"]);
    const publishedAt = dateRaw && !Number.isNaN(Date.parse(dateRaw)) ? new Date(dateRaw) : new Date();
    out.push({ url: normalizeUrl(link), title, summary: summary === title ? "" : summary, imageUrl: feedImage(it), publishedAt, sourceName: source.name, category: source.category });
  }
  return out;
}

/** Dedupe by normalized URL and by near-identical titles across sources. */
export function dedupeItems(items: ParsedItem[]): ParsedItem[] {
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  const out: ParsedItem[] = [];
  for (const it of items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())) {
    const t = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenUrl.has(it.url) || seenTitle.has(t)) continue;
    seenUrl.add(it.url);
    seenTitle.add(t);
    out.push(it);
  }
  return out;
}
