import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { MeetingActionItem } from "@/lib/db/schema";

/** Meeting notes keyed by Google Calendar event id. The calendar itself is never written. */

export async function getMeetingNote(userId: string, eventId: string) {
  return (await db().query.meetingNotes.findFirst({ where: and(eq(schema.meetingNotes.userId, userId), eq(schema.meetingNotes.eventId, eventId)) })) ?? null;
}

export async function createMeetingNote(
  userId: string,
  v: { eventId: string; eventTitle: string; eventStart: Date; eventEnd: Date | null; attendeeCount: number; notes: string },
) {
  const [row] = await db()
    .insert(schema.meetingNotes)
    .values({ userId, ...v })
    .onConflictDoUpdate({ target: [schema.meetingNotes.userId, schema.meetingNotes.eventId], set: { notes: v.notes, updatedAt: new Date() } })
    .returning();
  return row!;
}

export async function updateMeetingNotes(userId: string, eventId: string, notes: string) {
  const [row] = await db()
    .update(schema.meetingNotes)
    .set({ notes, updatedAt: new Date() })
    .where(and(eq(schema.meetingNotes.userId, userId), eq(schema.meetingNotes.eventId, eventId)))
    .returning();
  return row ?? null;
}

export async function saveMeetingSummary(
  userId: string,
  eventId: string,
  v: { summary: string; decisions: string[]; actionItems: MeetingActionItem[]; model: string; summarizedAt: Date },
) {
  await db()
    .update(schema.meetingNotes)
    .set({ ...v, updatedAt: new Date() })
    .where(and(eq(schema.meetingNotes.userId, userId), eq(schema.meetingNotes.eventId, eventId)));
}

export async function deleteMeetingNote(userId: string, eventId: string) {
  await db().delete(schema.meetingNotes).where(and(eq(schema.meetingNotes.userId, userId), eq(schema.meetingNotes.eventId, eventId)));
}

/** Which of these events already have notes (the schedule view marks them). */
export async function meetingNoteEventIds(userId: string, eventIds: string[]): Promise<Set<string>> {
  if (!eventIds.length) return new Set();
  const rows = await db()
    .select({ eventId: schema.meetingNotes.eventId })
    .from(schema.meetingNotes)
    .where(and(eq(schema.meetingNotes.userId, userId), inArray(schema.meetingNotes.eventId, eventIds)));
  return new Set(rows.map((r) => r.eventId));
}

export async function proposalsByIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  return db()
    .select({ id: schema.proposals.id, kind: schema.proposals.kind, summary: schema.proposals.summary, status: schema.proposals.status })
    .from(schema.proposals)
    .where(and(eq(schema.proposals.userId, userId), inArray(schema.proposals.id, ids)));
}
