import { z } from "zod";
import { AiLimitError } from "@/lib/ai/gate";
import { NoProviderError } from "@/lib/ai/router";
import { StructuredOutputError } from "@/lib/ai/structured";
import { apiGuard } from "@/lib/auth/api";
import { MeetingError, summarizeMeeting } from "@/lib/meetings/notes";
import { fail, noStore, readJson } from "@/lib/mobile/http";
import { rateLimit } from "@/lib/security/ratelimit";
import { AI_UNAVAILABLE } from "@/lib/ai/messages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** AI summary and action items (as pending create_task proposals). Nothing executes here. */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = z
    .object({ eventId: z.string().min(1).max(300).regex(/^[A-Za-z0-9_@.-]+$/) })
    .safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "Invalid meeting");
  const rl = await rateLimit("ai", `meeting:${g.user.id}`);
  if (!rl.success) return fail(429, "You're going a little fast. Try again in a moment.");
  try {
    await summarizeMeeting(g.user, parsed.data.eventId);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (err) {
    if (err instanceof MeetingError) return fail(422, err.message);
    if (err instanceof NoProviderError) return fail(422, AI_UNAVAILABLE);
    if (err instanceof AiLimitError) return fail(429, err.message);
    if (err instanceof StructuredOutputError) return fail(502, "Cowork couldn't summarize these notes. Try again.");
    throw err;
  }
}
