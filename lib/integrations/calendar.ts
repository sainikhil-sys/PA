import "server-only";
import { google } from "googleapis";
import { googleClient } from "./google";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  meetingUrl: string | null;
  attendees: { email: string; name: string | null; self: boolean }[];
  htmlLink: string | null;
};

/** Read-only: list events on the primary calendar in [timeMin, timeMax). */
export async function listEvents(userId: string, timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  const cal = google.calendar({ version: "v3", auth: await googleClient(userId) });
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });
  return (res.data.items ?? [])
    .filter((e) => e.status !== "cancelled")
    .map((e) => ({
      id: e.id ?? "",
      title: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? "",
      end: e.end?.dateTime ?? e.end?.date ?? "",
      allDay: !e.start?.dateTime,
      location: e.location ?? null,
      meetingUrl: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null,
      attendees: (e.attendees ?? []).map((a) => ({ email: a.email ?? "", name: a.displayName ?? null, self: Boolean(a.self) })),
      htmlLink: e.htmlLink ?? null,
    }));
}
