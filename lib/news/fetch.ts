import "server-only";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { errMessage, log } from "@/lib/log";
import { sha256 } from "@/lib/security/crypto";
import { dedupeItems, parseFeed, parseFeedConfig, type ParsedItem } from "./parse";

const MAX_FEED_BYTES = 2_000_000;
const RETENTION_MS = 3 * 86_400_000;

async function fetchFeed(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "PA-news/1.0 (+personal assistant; RSS reader)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > MAX_FEED_BYTES ? null : text;
  } catch (err) {
    log.warn("news.feed_failed", { url, error: errMessage(err) });
    return null;
  }
}

/** Optional NewsAPI.org headlines (NEWS_API_KEY). Titles + descriptions only. */
async function fetchNewsApi(topics: string[]): Promise<ParsedItem[]> {
  const key = env().NEWS_API_KEY;
  if (!key) return [];
  const map: Record<string, string> = { technology: "technology", business: "business", science: "science", health: "health", sports: "sports", world: "general" };
  const out: ParsedItem[] = [];
  for (const topic of topics.filter((t) => map[t]).slice(0, 3)) {
    try {
      const res = await fetch(`https://newsapi.org/v2/top-headlines?language=en&pageSize=10&category=${map[topic]}`, { headers: { "X-Api-Key": key }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = (await res.json()) as { articles?: { url: string; title: string; description?: string; publishedAt?: string; source?: { name?: string } }[] };
      for (const a of data.articles ?? []) {
        if (!a.url || !a.title) continue;
        out.push({ url: a.url, title: a.title.slice(0, 180), summary: (a.description ?? "").slice(0, 200), publishedAt: a.publishedAt ? new Date(a.publishedAt) : new Date(), sourceName: a.source?.name ?? "NewsAPI", category: topic });
      }
    } catch {
      // ignore one failing category
    }
  }
  return out;
}

/** Fetch configured feeds for the user's topics, dedupe, store new items, prune old ones. */
export async function refreshNews(userId: string, topics: string[]) {
  const feeds = parseFeedConfig(env().NEWS_FEEDS).filter((f) => topics.length === 0 || topics.includes(f.category));
  const xmls = await Promise.all(feeds.map(async (f) => ({ f, xml: await fetchFeed(f.url) })));
  const parsed = xmls.flatMap(({ f, xml }) => (xml ? parseFeed(xml, f) : []));
  const items = dedupeItems([...parsed, ...(await fetchNewsApi(topics))]).slice(0, 80);

  let inserted = 0;
  if (items.length) {
    const rows = await db()
      .insert(schema.newsItems)
      .values(items.map((i) => ({ userId, urlHash: sha256(i.url), url: i.url, sourceName: i.sourceName, title: i.title, summary: i.summary, category: i.category, publishedAt: i.publishedAt })))
      .onConflictDoNothing()
      .returning({ id: schema.newsItems.id });
    inserted = rows.length;
  }
  await db().delete(schema.newsItems).where(and(eq(schema.newsItems.userId, userId), lt(schema.newsItems.publishedAt, new Date(Date.now() - RETENTION_MS))));
  return { feeds: feeds.length, inserted };
}

export async function listNews(userId: string, topics: string[], limit = 24) {
  const conds = [eq(schema.newsItems.userId, userId)];
  if (topics.length) conds.push(inArray(schema.newsItems.category, topics));
  return db().select().from(schema.newsItems).where(and(...conds)).orderBy(desc(schema.newsItems.publishedAt)).limit(limit);
}
