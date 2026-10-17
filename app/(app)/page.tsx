import type { Metadata } from "next";
import { Suspense } from "react";
import { CardSkeleton, RibbonSkeleton } from "@/components/today/card-skeleton";
import { AgentCard, IdeasCard, IntegrationsStrip, MailCard, ScheduleCard, TasksCard } from "@/components/today/cards";
import { NewsRibbon } from "@/components/today/news-ribbon";
import { requireOwner } from "@/lib/auth/session";
import type { User } from "@/lib/db/schema";
import { getSettings } from "@/lib/db/queries/settings";
import { errMessage, log } from "@/lib/log";
import { ensureFreshNews, listNews } from "@/lib/news/fetch";
import { toNewsCard } from "@/lib/news/card";
import { after } from "next/server";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

async function News({ user }: { user: User }) {
  const s = await getSettings(user.id);
  let items = await listNews(user.id, s.newsTopics, 24).catch(() => []);
  if (!items.length) {
    // First visit (or nothing for these topics yet): fetch now, inside the ribbon's skeleton.
    await ensureFreshNews(user.id, s.newsTopics).catch((err) => log.warn("news.refresh_failed", { error: errMessage(err) }));
    items = await listNews(user.id, s.newsTopics, 24).catch(() => []);
  } else {
    // Stale? Refresh after the response is sent; the ribbon picks it up via /api/news.
    after(() => ensureFreshNews(user.id, s.newsTopics).catch((err) => log.warn("news.refresh_failed", { error: errMessage(err) })));
  }
  return <NewsRibbon items={items.map(toNewsCard)} />;
}

/** Bento grid: news ribbon, agent, schedule, tasks, mail, ideas, integrations. Each card streams in with its own skeleton. */
export default async function TodayPage() {
  const user = await requireOwner();
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <h1 className="sr-only">Today</h1>
      <Suspense fallback={<RibbonSkeleton />}>
        <News user={user} />
      </Suspense>
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-12">
        <div className="md:col-span-2 lg:col-span-4">
          <Suspense fallback={<CardSkeleton rows={2} />}>
            <AgentCard user={user} />
          </Suspense>
        </div>
        <div className="lg:col-span-4">
          <Suspense fallback={<CardSkeleton rows={4} />}>
            <ScheduleCard user={user} />
          </Suspense>
        </div>
        <div className="lg:col-span-4">
          <Suspense fallback={<CardSkeleton rows={4} />}>
            <TasksCard user={user} />
          </Suspense>
        </div>
        <div className="md:col-span-2 lg:col-span-7">
          <Suspense fallback={<CardSkeleton rows={3} />}>
            <MailCard user={user} />
          </Suspense>
        </div>
        <div className="md:col-span-2 lg:col-span-5">
          <Suspense fallback={<CardSkeleton rows={3} />}>
            <IdeasCard user={user} />
          </Suspense>
        </div>
        <div className="md:col-span-2 lg:col-span-12">
          <Suspense fallback={<CardSkeleton rows={1} />}>
            <IntegrationsStrip user={user} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
