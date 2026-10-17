import type { NewsItem } from "@/lib/db/schema";

/** Client-safe shape for the news ribbon (titles and one-line summaries only). */
export type NewsCard = { id: string; title: string; summary: string; sourceName: string; category: string; url: string; publishedAt: string; image: string | null };

export function toNewsCard(n: NewsItem): NewsCard {
  return { id: n.id, title: n.title, summary: n.summary, sourceName: n.sourceName, category: n.category, url: n.url, publishedAt: n.publishedAt.toISOString(), image: n.imageUrl ? `/api/news/${n.id}/image` : null /* "" = looked, none */ };
}
