import "server-only";
import { dismissProposal, PROPOSAL_LABEL, proposalFromAction } from "@/lib/agent/proposals";
import { generateObject } from "@/lib/ai/router";
import { logActivity } from "@/lib/db/queries/activity";
import { createMeetingNote, deleteMeetingNote, getMeetingNote, proposalsByIds, saveMeetingSummary, updateMeetingNotes } from "@/lib/db/queries/meetings";
import { getSettings } from "@/lib/db/queries/settings";
import type { MeetingActionItem, MeetingNote, User } from "@/lib/db/schema";
import { listEvents, type CalendarEvent } from "@/lib/integrations/calendar";
import { GoogleNotConnectedError } from "@/lib/integrations/google";
import { stripInvisible } from "@/lib/security/sanitize";
import { formatDateTime, localDate } from "@/lib/time";
import { buildMeetingPrompt, MEETING_SYSTEM, meetingExtractSchema, normalizeActionItems } from "./prompt";

export class MeetingError extends Error {}

/** Resolve one event by id from a ±1 minute window around its start (read-only). Lets GoogleNotConnectedError through. */
export async function findEvent(userId: string, eventId: string, at: Date): Promise<CalendarEvent | null> {
  const events = await listEvents(userId, new Date(at.getTime() - 60_000), new Date(at.getTime() + 60_000));
  return events.find((e) => e.id === eventId) ?? null;
}

/**
 * Summarize the notes with the model and turn each action item into a pending
 * create_task proposal. Nothing runs until the owner approves a proposal, and
 * re-summarizing dismisses the previous pending ones.
 */
export async function summarizeMeeting(user: User, eventId: string) {
  const note = await getMeetingNote(user.id, eventId);
  if (!note) throw new MeetingError("Save some notes first.");
  if (note.notes.trim().length < 20) throw new MeetingError("Write a few lines of notes first.");
  const { timezone } = await getSettings(user.id);

  // Display names only, never emails, and only for this one call.
  let attendees: string[] = [];
  try {
    const ev = await findEvent(user.id, eventId, note.eventStart);
    attendees = (ev?.attendees ?? []).filter((a) => !a.self && a.name).map((a) => a.name!);
  } catch {
    attendees = [];
  }

  const prompt = buildMeetingPrompt({
    ownerName: user.name ?? "the owner",
    today: localDate(timezone),
    timezone,
    title: note.eventTitle,
    when: formatDateTime(note.eventStart, timezone),
    attendees,
    notes: note.notes,
  });
  const { value, model } = await generateObject({ kind: "meeting_summary", userId: user.id, tier: "smart", system: MEETING_SYSTEM, prompt, schema: meetingExtractSchema });
  const items = normalizeActionItems(value.action_items, user.name);

  for (const old of note.actionItems) if (old.proposalId) await dismissProposal(user.id, old.proposalId);

  const actionItems: MeetingActionItem[] = [];
  for (const item of items) {
    const p = await proposalFromAction(
      user,
      { kind: "create_task", title: item.taskTitle, when: item.due ?? undefined, details: `From meeting "${note.eventTitle}" on ${formatDateTime(note.eventStart, timezone)}.` },
      { source: "meeting" },
    );
    actionItems.push({ title: item.title, owner: item.owner, due: item.due, proposalId: p?.id ?? null });
  }

  await saveMeetingSummary(user.id, eventId, {
    summary: stripInvisible(value.summary).trim(),
    decisions: value.decisions.map((d) => stripInvisible(d).trim()).filter(Boolean).slice(0, 8),
    actionItems,
    model,
    summarizedAt: new Date(),
  });
  await logActivity({ userId: user.id, actor: "agent", tool: "meeting.summarized", inputSummary: `${items.length} action items`, outcome: "success" });
  return { items: actionItems.length };
}

export type MeetingView = {
  notes: string;
  summary: string | null;
  decisions: string[];
  summarizedAt: string | null;
  updatedAt: string;
  items: { title: string; owner: string | null; due: string | null; proposal: { id: string; kind: string; label: string; summary: string; status: string } | null }[];
};

/** The note as the sheet shows it, with each action item's live proposal status. */
export async function meetingView(userId: string, note: MeetingNote): Promise<MeetingView> {
  const ids = note.actionItems.map((i) => i.proposalId).filter((x): x is string => Boolean(x));
  const byId = new Map((await proposalsByIds(userId, ids)).map((p) => [p.id, p]));
  return {
    notes: note.notes,
    summary: note.summary,
    decisions: note.decisions,
    summarizedAt: note.summarizedAt?.toISOString() ?? null,
    updatedAt: note.updatedAt.toISOString(),
    items: note.actionItems.map((i) => {
      const p = i.proposalId ? byId.get(i.proposalId) : undefined;
      return { title: i.title, owner: i.owner, due: i.due, proposal: p ? { id: p.id, kind: p.kind, label: PROPOSAL_LABEL[p.kind] ?? p.kind, summary: p.summary, status: p.status } : null };
    }),
  };
}

/**
 * Save notes for one calendar event (shared by the website and the app). The first save snapshots
 * the event (no attendee names or emails). Throws MeetingError for things the person can fix.
 */
export async function saveMeetingNotes(userId: string, input: { eventId: string; at: string; notes: string }) {
  const existing = await getMeetingNote(userId, input.eventId);
  if (existing) {
    await updateMeetingNotes(userId, input.eventId, input.notes);
    return;
  }
  let ev;
  try {
    ev = await findEvent(userId, input.eventId, new Date(input.at));
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) throw new MeetingError(err.message);
    throw err;
  }
  if (!ev || ev.allDay) throw new MeetingError("This meeting isn't on your calendar anymore.");
  await createMeetingNote(userId, {
    eventId: input.eventId,
    eventTitle: ev.title.slice(0, 300),
    eventStart: new Date(ev.start),
    eventEnd: ev.end ? new Date(ev.end) : null,
    attendeeCount: ev.attendees.length,
    notes: input.notes,
  });
}

/** Delete one meeting's notes and dismiss any action items still waiting for approval. */
export async function deleteMeetingNotes(userId: string, eventId: string) {
  const note = await getMeetingNote(userId, eventId);
  if (!note) return;
  for (const i of note.actionItems) if (i.proposalId) await dismissProposal(userId, i.proposalId);
  await deleteMeetingNote(userId, eventId);
  await logActivity({ userId, actor: "me", tool: "meeting.notes_deleted", inputSummary: `${note.actionItems.length} action items`, outcome: "success" });
}
