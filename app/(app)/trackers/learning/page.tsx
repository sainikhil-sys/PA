import type { Metadata } from "next";
import { LearningView } from "@/components/trackers/learning-view";
import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/queries/settings";
import { addDays, currentStreak, todayIn, weekStart } from "@/lib/trackers/dates";
import { listLearningItems, loggedDaysSince, minutesByItem, minutesSince } from "@/lib/trackers/queries";

export const metadata: Metadata = { title: "Learning" };
export const dynamic = "force-dynamic";

/** Streaks longer than this many days read as "366+" rather than scanning all history. */
const STREAK_WINDOW = 366;

export default async function LearningPage() {
  const user = await requireOwner();
  const { timezone } = await getSettings(user.id);
  const today = todayIn(timezone);
  const [items, perItem, weekMinutes, days] = await Promise.all([
    listLearningItems(user.id),
    minutesByItem(user.id),
    minutesSince(user.id, weekStart(today)),
    loggedDaysSince(user.id, addDays(today, -STREAK_WINDOW)),
  ]);
  const streak = currentStreak(days, today);
  return (
    <LearningView
      today={today}
      weekMinutes={weekMinutes}
      streak={Math.min(streak, STREAK_WINDOW)}
      streakCapped={streak > STREAK_WINDOW}
      items={items.map(({ completedAt, ...i }) => ({ ...i, completedOn: completedAt ? todayIn(timezone, completedAt) : null, updatedAt: i.updatedAt.toISOString(), minutes: perItem.get(i.id) ?? 0 }))}
    />
  );
}
