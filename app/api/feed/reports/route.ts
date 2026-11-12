import { z } from "zod";
import { body, handle, uuidSchema } from "@/lib/social/http";
import { reportContent } from "@/lib/feed/posts";
import { REPORT_REASONS } from "@/lib/social/rules";

export const dynamic = "force-dynamic";

const schema = z.object({
  postId: uuidSchema.nullish(),
  commentId: uuidSchema.nullish(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).nullish(),
});

/** Report a post or a comment. It goes to the review queue in the console. */
export async function POST(req: Request) {
  return handle(req, async (user) => {
    await reportContent(user.id, await body(req, schema));
    return { ok: true };
  });
}
