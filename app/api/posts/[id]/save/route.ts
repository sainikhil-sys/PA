import { handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { toggleSave } from "@/lib/feed/posts";

export const dynamic = "force-dynamic";

/** Save the post, or unsave it if it's already saved. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ saved: await toggleSave(user.id, param((await params).id, uuidSchema)) }));
}
