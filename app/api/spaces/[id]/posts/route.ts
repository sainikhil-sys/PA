import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { POST_MAX } from "@/lib/feed/posts";
import { postInSpace, spacePosts } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The Space's posts you may read: {pinned, items, next}. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => spacePosts(user, param((await params).id, uuidSchema), new URL(req.url).searchParams.get("cursor")));
}

const schema = z.object({
  body: z.string().max(POST_MAX).default(""),
  kind: z.enum(["post", "announcement", "question"]).optional(),
  mediaIds: z.array(uuidSchema).max(10).optional(),
  poll: z
    .object({ options: z.array(z.string().max(80)).min(2).max(6), multiple: z.boolean().optional(), closesAt: z.coerce.date().nullish() })
    .nullish(),
});

/** Post in a Space you're a member of. Announcements: owners and moderators. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ post: await postInSpace(user, param((await params).id, uuidSchema), await body(req, schema)) }));
}
