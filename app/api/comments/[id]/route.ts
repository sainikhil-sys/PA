import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { deleteComment } from "@/lib/feed/posts";

export const dynamic = "force-dynamic";

/** Delete your comment, or a comment on your post. */
export async function DELETE(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await deleteComment(user.id, param((await params).id, uuidSchema));
    return { ok: true };
  });
}
