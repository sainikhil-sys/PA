import "server-only";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { errMessage, log } from "@/lib/log";
import { sha256 } from "@/lib/security/crypto";
import { dedupeItems, pageImage, parseFeed, parseFeedConfig, type ParsedItem } from "./parse";

const MAX_FEED_BYTES = 2_000_000;
const RETENTION_MS = 3 * 86_400_000;

async function fetchFeed(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Cowork-news/1.0 (+personal assistant; RSS reader)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
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
      .values(items.map((i) => ({ userId, urlHash: sha256(i.url), url: i.url, sourceName: i.sourceName, title: i.title, summary: i.summary, imageUrl: i.imageUrl ?? null, category: i.category, publishedAt: i.publishedAt })))
      .onConflictDoNothing()
      .returning({ id: schema.newsItems.id });
    inserted = rows.length;
  }
  await db().delete(schema.newsItems).where(and(eq(schema.newsItems.userId, userId), lt(schema.newsItems.publishedAt, new Date(Date.now() - RETENTION_MS))));
  return { feeds: feeds.length, inserted };
}

export const NEWS_MAX_AGE_MS = 30 * 60_000;
const inflight = new Map<string, Promise<unknown>>();

/** When the newest stored headline was fetched (null if none). */
export async function lastNewsFetch(userId: string): Promise<Date | null> {
  const [row] = await db()
    .select({ at: schema.newsItems.createdAt })
    .from(schema.newsItems)
    .where(eq(schema.newsItems.userId, userId))
    .orderBy(desc(schema.newsItems.createdAt))
    .limit(1);
  return row?.at ?? null;
}

/**
 * Refresh feeds if nothing is stored yet or the newest item is older than 30 min.
 * The cron dispatcher does this on Vercel; this covers local dev and first loads.
 * Concurrent callers share one refresh per user.
 */
export async function ensureFreshNews(userId: string, topics: string[], maxAgeMs = NEWS_MAX_AGE_MS): Promise<boolean> {
  // A refresh that found no NEW stories still counts as fresh (tracked per instance).
  const checked = lastChecked.get(userId);
  if (checked && Date.now() - checked < maxAgeMs) return false;
  const last = await lastNewsFetch(userId);
  if (last && Date.now() - last.getTime() < maxAgeMs) return false;
  let p = inflight.get(userId);
  if (!p) {
    p = refreshNews(userId, topics)
      .then(() => lastChecked.set(userId, Date.now()))
      .finally(() => inflight.delete(userId));
    inflight.set(userId, p);
  }
  await p;
  return true;
}
const lastChecked = new Map<string, number>();

export async function listNews(userId: string, topics: string[], limit = 24) {
  const conds = [eq(schema.newsItems.userId, userId)];
  if (topics.length) conds.push(inArray(schema.newsItems.category, topics));
  return db().select().from(schema.newsItems).where(and(...conds)).orderBy(desc(schema.newsItems.publishedAt)).limit(limit);
}

/**
 * Fill lead images for recent stories whose feed had none, from the article's own preview image.
 * Small batch, in parallel, best effort. "" marks "looked, none found" so pages aren't refetched.
 */
export async function backfillNewsImages(userId: string, limit = 12) {
  const rows = await db()
    .select({ id: schema.newsItems.id, url: schema.newsItems.url })
    .from(schema.newsItems)
    .where(and(eq(schema.newsItems.userId, userId), isNull(schema.newsItems.imageUrl)))
    .orderBy(desc(schema.newsItems.publishedAt))
    .limit(limit);
  await Promise.all(
    rows.map(async (r) => {
      let image = "";
      try {
        if (r.url.startsWith("https://")) {
          const res = await fetch(r.url, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "user-agent": "Mozilla/5.0 (compatible; Cowork-news/1.0)", accept: "text/html" } });
          if (res.ok && (res.headers.get("content-type") ?? "").includes("html")) {
            const reader = res.body?.getReader();
            let html = "";
            const dec = new TextDecoder();
            while (reader && html.length < 200_000) {
              const { done, value } = await reader.read();
              if (done) break;
              html += dec.decode(value, { stream: true });
              if (/<\/head>/i.test(html)) break;
            }
            await reader?.cancel().catch(() => {});
            image = pageImage(html) ?? "";
          }
        }
      } catch {
        image = "";
      }
      await db().update(schema.newsItems).set({ imageUrl: image }).where(eq(schema.newsItems.id, r.id));
    }),
  );
  return rows.length;
}
