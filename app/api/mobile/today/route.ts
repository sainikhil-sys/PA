import { pendingProposalCount } from "@/lib/agent/proposals";
import { apiGuard } from "@/lib/auth/api";
import { latestBriefing } from "@/lib/db/queries/briefings";
import { listImportantEmails } from "@/lib/db/queries/emails";
import { getSettings } from "@/lib/db/queries/settings";
import { needsReview, topPriorities } from "@/lib/db/queries/tasks";
import { listEvents } from "@/lib/integrations/calendar";
import { GoogleNotConnectedError } from "@/lib/integrations/google";
import { errMessage, log } from "@/lib/log";
import { noStore } from "@/lib/mobile/http";
import { localDayBounds } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Everything the app's Today screen shows, in ONE request: each round trip from a phone to the
 * database region costs ~300 ms, so the screen must not fan out into many calls.
 */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const u = g.user;
  const s = await getSettings(u.id);
  const { start, end, date } = localDayBounds(s.timezone, 0);

  const calendar = listEvents(u.id, start, end)
    .then((items) => ({ connected: true, failed: false, items }))
    .catch((err) => {
      if (!(err instanceof GoogleNotConnectedError)) log.warn("mobile.today_calendar_failed", { error: errMessage(err) });
      const notConnected = err instanceof GoogleNotConnectedError;
      return { connected: !notConnected, failed: !notConnected, items: [] };
    });
  const [briefing, cal, priorities, review, mail, pending] = await Promise.all([
    latestBriefing(u.id).catch(() => null),
    calendar,
    topPriorities(u.id, 5),
    needsReview(u.id, 3),
    listImportantEmails(u.id, 4),
    pendingProposalCount(u.id),
  ]);

  const task = (t: (typeof priorities)[number]) => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate, status: t.status, assignee: t.assignee });
  return Response.json(
    {
      date,
      timezone: s.timezone,
      agentName: s.agent.name,
      briefing: briefing
        ? { date: briefing.date, isToday: briefing.date === date, headline: briefing.content.headline, summary: briefing.content.summary, priorities: briefing.content.priorities.slice(0, 4) }
        : null,
      calendarConnected: cal.connected,
      // True when the calendar is connected but could not be read, so the app never says "nothing today".
      calendarFailed: cal.failed,
      events: cal.items.slice(0, 8).map((e) => ({ title: e.title, start: e.start, end: e.end, location: e.location ?? null })),
      tasks: priorities.map(task),
      review: review.map(task),
      mail: mail.map((m) => ({ id: m.id, from: m.fromName ?? m.fromEmail ?? "Unknown", subject: m.subject, summary: m.summary ?? m.snippet, category: m.category, receivedAt: m.receivedAt })),
      pendingApprovals: pending,
    },
    { headers: noStore },
  );
}
