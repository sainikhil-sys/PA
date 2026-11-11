import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { deleteMeetingNotes, MeetingError, saveMeetingNotes } from "@/lib/meetings/notes";
import { fail, noStore, readJson } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

// Reading one meeting is GET /api/meetings?eventId=&at=, shared with the web.
const eventId = z.string().min(1).max(300).regex(/^[A-Za-z0-9_@.-]+$/, "Invalid meeting");

/** Save notes for one calendar event. */
export async function PUT(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = z
    .object({ eventId, at: z.string().datetime({ offset: true }), notes: z.string().max(20_000, "Notes are too long.") })
    .safeParse(await readJson(req));
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid notes");
  try {
    await saveMeetingNotes(g.user.id, parsed.data);
  } catch (err) {
    if (err instanceof MeetingError) return fail(422, err.message);
    throw err;
  }
  return Response.json({ ok: true, savedAt: new Date().toISOString() }, { headers: noStore });
}

/** DELETE ?eventId=: delete the notes and dismiss action items still waiting for approval. */
export async function DELETE(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = eventId.safeParse(new URL(req.url).searchParams.get("eventId"));
  if (!parsed.success) return fail(400, "Invalid meeting");
  await deleteMeetingNotes(g.user.id, parsed.data);
  return Response.json({ ok: true }, { headers: noStore });
}
