import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { vote } from "@/lib/feed/posts";

export const dynamic = "force-dynamic";

/** Vote in a poll: {option} is the option's index. Returns the post with the new counts. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { option } = await body(req, z.object({ option: z.number().int().min(0).max(5) }));
    return { post: await vote(user, param((await params).id, uuidSchema), option) };
  });
}
