import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { deletePost, editPost, getPost, POST_MAX } from "@/lib/feed/posts";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ post: await getPost(user.id, param((await params).id, uuidSchema)) }));
}

/** Edit your own post's text. It is checked again. */
export async function PATCH(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const id = param((await params).id, uuidSchema);
    const { body: text } = await body(req, z.object({ body: z.string().max(POST_MAX) }));
    return { post: await editPost(user, id, text) };
  });
}

export async function DELETE(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await deletePost(user.id, param((await params).id, uuidSchema));
    return { ok: true };
  });
}
