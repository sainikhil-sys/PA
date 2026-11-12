import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { hidePost } from "@/lib/feed/posts";

export const dynamic = "force-dynamic";

/** "Not interested": this post won't appear in your feeds again. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await hidePost(user.id, param((await params).id, uuidSchema));
    return { ok: true };
  });
}
