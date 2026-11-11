"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { NoProviderError } from "@/lib/ai/router";
import { StructuredOutputError } from "@/lib/ai/structured";
import { deleteMeetingNotes, MeetingError, saveMeetingNotes, summarizeMeeting } from "@/lib/meetings/notes";
import { rateLimit } from "@/lib/security/ratelimit";

const eventId = z.string().min(1).max(300).regex(/^[A-Za-z0-9_@.-]+$/, "Invalid meeting");
// Google start times carry an offset, e.g. 2026-10-19T09:00:00+05:30.
const at = z.string().datetime({ offset: true });

/** Save notes for one calendar event (shared with the app: saveMeetingNotes). */
export const saveMeetingNotesAction = ownerAction(
  z.object({ eventId, at, notes: z.string().max(20_000, "Notes are too long") }),
  async (input, user) => {
    try {
      await saveMeetingNotes(user.id, input);
    } catch (err) {
      if (err instanceof MeetingError) throw new UserFacingError(err.message);
      throw err;
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
  await deleteMeetingNotes(user.id, input.eventId);
  revalidatePath("/", "layout");
});
