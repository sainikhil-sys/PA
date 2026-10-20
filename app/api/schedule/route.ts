import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { getSettings } from "@/lib/db/queries/settings";
import { meetingNoteEventIds } from "@/lib/db/queries/meetings";
import { listScheduled } from "@/lib/db/queries/tasks";
import { listEvents } from "@/lib/integrations/calendar";
import { GoogleNotConnectedError } from "@/lib/integrations/google";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";

const q = z.object({ from: z.string().datetime(), to: z.string().datetime() });

/** Calendar events (read-only from Google) + scheduled tasks for a range (max 45 days). */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const url = new URL(req.url);
  const parsed = q.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return errorJson(400, "invalid range");
  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  if (to.getTime() - from.getTime() > 45 * 86_400_000 || to <= from) return errorJson(400, "range too large");
  const { timezone } = await getSettings(g.user.id);
  let calendar: "ok" | "not_connected" | "error" = "ok";
  const events = await listEvents(g.user.id, from, to).catch((err) => {
    calendar = err instanceof GoogleNotConnectedError ? "not_connected" : "error";
    return [];
  });
  const tasks = await listScheduled(g.user.id, from, to);
  const noted = await meetingNoteEventIds(g.user.id, events.map((e) => e.id)).catch(() => new Set<string>());
  return Response.json(
    {
      timezone,
      calendar,
      events: events.map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, meetingUrl: e.meetingUrl, attendees: e.attendees.length, hasNotes: noted.has(e.id) })),
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, start: t.scheduledAt!.toISOString(), durationMinutes: t.durationMinutes ?? 30, status: t.status, recurring: Boolean(t.recurrence) })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
