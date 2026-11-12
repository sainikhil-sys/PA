import { handle } from "@/lib/social/http";
import { savedFeed } from "@/lib/feed/posts";

export const dynamic = "force-dynamic";

/** Posts you saved, newest first. Only you can see this list. */
export async function GET(req: Request) {
  return handle(req, (user) => savedFeed(user.id, new URL(req.url).searchParams.get("cursor")));
}
