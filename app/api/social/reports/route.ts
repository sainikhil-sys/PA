import { z } from "zod";
import { body, handle, uuidSchema } from "@/lib/social/http";
import { REPORT_REASONS } from "@/lib/social/rules";
import { report } from "@/lib/social/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  userId: uuidSchema.nullish(),
  messageId: uuidSchema.nullish(),
  threadId: uuidSchema.nullish(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().max(1000).nullish(),
});

/** Report a person, a message or a group to Cowork's moderators. */
export async function POST(req: Request) {
  return handle(req, async (user) => {
    await report(user.id, await body(req, schema));
    return { ok: true };
  });
}
