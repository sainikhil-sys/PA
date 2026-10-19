import type { Metadata } from "next";
import { Suspense } from "react";
import { BriefingCard } from "@/components/today/briefing-card";
import { CardSkeleton, RibbonSkeleton } from "@/components/today/card-skeleton";
import { AgentCard, IdeasCard, IntegrationsStrip, MailCard, ScheduleCard, TasksCard } from "@/components/today/cards";
import { NewsRibbon } from "@/components/today/news-ribbon";
import { PhoneCard } from "@/components/today/phone-card";
import { RoomRow } from "@/components/today/room";
import { TodayGrid } from "@/components/today/today-grid";
import { listPhoneFeed } from "@/lib/phone-server";
import { requireOwner } from "@/lib/auth/session";
import type { User } from "@/lib/db/schema";
import { getSettings } from "@/lib/db/queries/settings";
import { errMessage, log } from "@/lib/log";
import { backfillNewsImages, ensureFreshNews, listNews } from "@/lib/news/fetch";
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
    after(async () => {
      await ensureFreshNews(user.id, s.newsTopics).catch((err) => log.warn("news.refresh_failed", { error: errMessage(err) }));
      await backfillNewsImages(user.id).catch(() => 0);
    });
  }
  return <NewsRibbon items={items.map(toNewsCard)} />;
}

/** Linked phone at a glance (live via /api/phone/feed). */
async function PhoneSection({ user }: { user: User }) {
  return <PhoneCard initial={await listPhoneFeed(user.id, 20).catch(() => ({ devices: [], events: [] }))} />;
}

/** Room: wallpaper, focus clock, music and video. Then the bento grid: news ribbon, agent, schedule, tasks, mail, ideas, integrations. Each card streams in with its own skeleton. */
export default async function TodayPage() {
  const user = await requireOwner();
  const s = await getSettings(user.id);
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <h1 className="sr-only">Today</h1>
      <Suspense fallback={<RibbonSkeleton />}>
        <News user={user} />
      </Suspense>
      <RoomRow room={s.room} />
      {/* Drag cards by their handle to rearrange; the order is saved per account. */}
      <TodayGrid
        initialOrder={s.todayLayout}
        items={[
          { id: "agent", label: "Agent", className: "md:col-span-2 lg:col-span-4", node: <Suspense fallback={<CardSkeleton rows={2} />}><AgentCard user={user} /></Suspense> },
          { id: "schedule", label: "Schedule", className: "lg:col-span-4", node: <Suspense fallback={<CardSkeleton rows={4} />}><ScheduleCard user={user} /></Suspense> },
          { id: "tasks", label: "Tasks", className: "lg:col-span-4", node: <Suspense fallback={<CardSkeleton rows={4} />}><TasksCard user={user} /></Suspense> },
          { id: "briefing", label: "Briefing", className: "md:col-span-2 lg:col-span-12", node: <Suspense fallback={<CardSkeleton rows={3} />}><BriefingCard user={user} /></Suspense> },
          { id: "mail", label: "Mail", className: "md:col-span-2 lg:col-span-7", node: <Suspense fallback={<CardSkeleton rows={3} />}><MailCard user={user} /></Suspense> },
          { id: "phone", label: "Phone", className: "md:col-span-2 lg:col-span-5", node: <Suspense fallback={<CardSkeleton rows={3} />}><PhoneSection user={user} /></Suspense> },
          { id: "ideas", label: "Ideas", className: "md:col-span-2 lg:col-span-12", node: <Suspense fallback={<CardSkeleton rows={3} />}><IdeasCard user={user} /></Suspense> },
          { id: "integrations", label: "Integrations", className: "md:col-span-2 lg:col-span-12", node: <Suspense fallback={<CardSkeleton rows={1} />}><IntegrationsStrip user={user} /></Suspense> },
        ]}
      />
    </div>
  );
}
