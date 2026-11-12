import { handle } from "@/lib/social/http";
import { followingFeed, forYouFeed } from "@/lib/feed/posts";

export const dynamic = "force-dynamic";

/** GET ?tab=following|foryou&cursor=: a page of posts and the cursor for the next one (null at the end). */
export async function GET(req: Request) {
  return handle(req, async (user) => {
    const sp = new URL(req.url).searchParams;
    const cursor = sp.get("cursor");
    return sp.get("tab") === "foryou" ? forYouFeed(user.id, cursor) : followingFeed(user.id, cursor);
  });
}
