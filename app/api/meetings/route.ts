import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { getMeetingNote } from "@/lib/db/queries/meetings";
import { GoogleNotConnectedError } from "@/lib/integrations/google";
import { findEvent, meetingView } from "@/lib/meetings/notes";
import { errorJson } from "@/lib/security/request";

export const dynamic = "force-dynamic";

const q = z.object({
  eventId: z.string().min(1).max(300).regex(/^[A-Za-z0-9_@.-]+$/),
  at: z.string().datetime({ offset: true }).optional(),
});

/** One meeting's notes; falls back to a read-only calendar lookup when there are none yet. */
export async function GET(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const uid = g.user.id;
  const url = new URL(req.url);
  const parsed = q.safeParse({ eventId: url.searchParams.get("eventId"), at: url.searchParams.get("at") || undefined });
  if (!parsed.success) return errorJson(400, "invalid");
  const { eventId, at } = parsed.data;
  const headers = { "cache-control": "no-store" };

  const note = await getMeetingNote(uid, eventId);
  if (note) {
    return Response.json(
      {
        calendar: "ok",
        event: { id: eventId, title: note.eventTitle, start: note.eventStart.toISOString(), end: note.eventEnd?.toISOString() ?? null, attendees: note.attendeeCount, meetingUrl: null, allDay: false },
        note: await meetingView(uid, note),
      },
      { headers },
    );
  }
  if (!at) return Response.json({ calendar: "ok", event: null, note: null }, { headers });
  try {
    const e = await findEvent(uid, eventId, new Date(at));
    return Response.json(
      { calendar: "ok", event: e ? { id: e.id, title: e.title, start: e.start, end: e.end, attendees: e.attendees.length, meetingUrl: e.meetingUrl, allDay: e.allDay } : null, note: null },
      { headers },
    );
  } catch (err) {
    return Response.json({ calendar: err instanceof GoogleNotConnectedError ? "not_connected" : "error", event: null, note: null }, { headers });
  }
}
