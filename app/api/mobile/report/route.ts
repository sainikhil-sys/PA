import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api";
import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/db/queries/activity";
import { sendTelegram } from "@/lib/db/queries/notifications";
import { fail, noStore, readJson } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";

const body = z.object({
  messageId: z.string().uuid(),
  reason: z.enum(["harmful", "offensive", "inaccurate", "other"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * "Report this response" on an AI answer (Google Play requires in-app reporting for generative AI).
 * Logged for review and flagged to the admin chat. The message text itself is not forwarded.
 */
export async function POST(req: Request) {
  const g = await apiGuard(req);
  if ("response" in g) return g.response;
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) return fail(400, "Choose a reason");
  const [msg] = await db()
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(eq(schema.messages.id, parsed.data.messageId), eq(schema.messages.userId, g.user.id), eq(schema.messages.role, "assistant")))
    .limit(1);
  if (!msg) return fail(404, "That message no longer exists.");
  await logActivity({
    userId: g.user.id,
    actor: "me",
    tool: "ai.response_reported",
    inputSummary: `${parsed.data.reason}: message ${msg.id}${parsed.data.note ? ` · ${parsed.data.note.slice(0, 200)}` : ""}`,
    outcome: "success",
  });
  await sendTelegram(`AI response reported (${parsed.data.reason}) · message ${msg.id}`);
  return Response.json({ ok: true }, { headers: noStore });
}
