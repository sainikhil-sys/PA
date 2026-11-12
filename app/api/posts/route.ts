import { z } from "zod";
import { body, handle, uuidSchema } from "@/lib/social/http";
import { createPost, MEDIA_PER_POST, POST_MAX } from "@/lib/feed/posts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  body: z.string().max(POST_MAX, `Posts can be up to ${POST_MAX} characters.`).default(""),
  visibility: z.enum(["public", "followers", "friends"]).default("public"),
  mediaIds: z.array(uuidSchema).max(MEDIA_PER_POST, `Up to ${MEDIA_PER_POST} photos per post.`).default([]),
});

/** Publish a post. Teens and private accounts can't post publicly; "public" becomes followers only. */
export async function POST(req: Request) {
  return handle(req, async (user) => ({ post: await createPost(user, await body(req, schema)) }));
}
