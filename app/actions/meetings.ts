"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dismissProposal } from "@/lib/agent/proposals";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { NoProviderError } from "@/lib/ai/router";
import { StructuredOutputError } from "@/lib/ai/structured";
import { logActivity } from "@/lib/db/queries/activity";
import { createMeetingNote, deleteMeetingNote, getMeetingNote, updateMeetingNotes } from "@/lib/db/queries/meetings";
import { GoogleNotConnectedError } from "@/lib/integrations/google";
import { findEvent, MeetingError, summarizeMeeting } from "@/lib/meetings/notes";
import { rateLimit } from "@/lib/security/ratelimit";

const eventId = z.string().min(1).max(300).regex(/^[A-Za-z0-9_@.-]+$/, "Invalid meeting");
// Google start times carry an offset, e.g. 2026-10-19T09:00:00+05:30.
const at = z.string().datetime({ offset: true });

/** Save notes for one calendar event. The first save snapshots the event (no attendee names or emails). */
export const saveMeetingNotesAction = ownerAction(
  z.object({ eventId, at, notes: z.string().max(20_000, "Notes are too long") }),
  async (input, user) => {
    const existing = await getMeetingNote(user.id, input.eventId);
    if (existing) {
      await updateMeetingNotes(user.id, input.eventId, input.notes);
    } else {
      let ev;
      try {
        ev = await findEvent(user.id, input.eventId, new Date(input.at));
      } catch (err) {
        if (err instanceof GoogleNotConnectedError) throw new UserFacingError(err.message);
        throw err;
      }
      if (!ev || ev.allDay) throw new UserFacingError("This meeting isn't on your calendar anymore.");
      await createMeetingNote(user.id, {
        eventId: input.eventId,
        eventTitle: ev.title.slice(0, 300),
        eventStart: new Date(ev.start),
        eventEnd: ev.end ? new Date(ev.end) : null,
        attendeeCount: ev.attendees.length,
        notes: input.notes,
      });
    }
    return { savedAt: new Date().toISOString() };
  },
);

/** AI summary + action items as pending create_task proposals. Nothing executes here. */
export const summarizeMeetingAction = ownerAction(z.object({ eventId }), async (input, user) => {
  const rl = await rateLimit("ai", `meeting:${user.id}`);
  if (!rl.success) throw new UserFacingError("You're going a little fast. Try again in a moment.");
  try {
    const res = await summarizeMeeting(user, input.eventId);
    revalidatePath("/", "layout");
    return res;
  } catch (err) {
    if (err instanceof MeetingError) throw new UserFacingError(err.message);
    if (err instanceof NoProviderError) throw new UserFacingError("Connect an AI provider in Settings > Agent to summarize meetings.");
    if (err instanceof StructuredOutputError) throw new UserFacingError("The model couldn't summarize these notes. Try again.");
    throw err;
  }
});

/** Delete the notes and dismiss any action items still waiting for approval. */
export const deleteMeetingNotesAction = ownerAction(z.object({ eventId }), async (input, user) => {
  const note = await getMeetingNote(user.id, input.eventId);
  if (!note) return;
  for (const i of note.actionItems) if (i.proposalId) await dismissProposal(user.id, i.proposalId);
  await deleteMeetingNote(user.id, input.eventId);
  await logActivity({ userId: user.id, actor: "me", tool: "meeting.notes_deleted", inputSummary: `${note.actionItems.length} action items`, outcome: "success" });
  revalidatePath("/", "layout");
});
