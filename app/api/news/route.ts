import { after } from "next/server";
import { apiGuard } from "@/lib/auth/api";
import { getSettings } from "@/lib/db/queries/settings";
import { errMessage, log } from "@/lib/log";
import { toNewsCard } from "@/lib/news/card";
import { ensureFreshNews, listNews } from "@/lib/news/fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Headlines for the Today ribbon. Triggers a background refresh when stale (>30 min). */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const s = await getSettings(g.user.id);
  after(() => ensureFreshNews(g.user.id, s.newsTopics).catch((err) => log.warn("news.refresh_failed", { error: errMessage(err) })));
  const items = await listNews(g.user.id, s.newsTopics, 24);
  return Response.json({ items: items.map(toNewsCard) }, { headers: { "cache-control": "no-store" } });
}
