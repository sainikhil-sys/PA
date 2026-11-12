import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { addComment, COMMENT_MAX, listComments } from "@/lib/feed/posts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Comments, oldest first: ?cursor= for the next page. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => listComments(user.id, param((await params).id, uuidSchema), new URL(req.url).searchParams.get("cursor")));
}

const schema = z.object({ body: z.string().max(COMMENT_MAX), parentId: uuidSchema.nullish() });

export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ comment: await addComment(user, param((await params).id, uuidSchema), await body(req, schema)) }));
}
