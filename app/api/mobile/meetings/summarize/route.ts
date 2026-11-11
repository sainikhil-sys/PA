import { z } from "zod";
import { NoProviderError } from "@/lib/ai/router";
import { StructuredOutputError } from "@/lib/ai/structured";
import { apiGuard } from "@/lib/auth/api";
import { MeetingError, summarizeMeeting } from "@/lib/meetings/notes";
import { fail, noStore, readJson } from "@/lib/mobile/http";
import { rateLimit } from "@/lib/security/ratelimit";

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
    if (err instanceof NoProviderError) return fail(422, "Connect an AI provider in Settings > Agent on the website to summarize meetings.");
    if (err instanceof StructuredOutputError) return fail(502, "The model couldn't summarize these notes. Try again.");
    throw err;
  }
}
