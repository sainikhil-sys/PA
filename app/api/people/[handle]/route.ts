import { handle } from "@/lib/social/http";
import { profilePosts } from "@/lib/feed/posts";
import { profileView } from "@/lib/feed/profiles";

export const dynamic = "force-dynamic";

/** A person's profile and the posts you may see: ?cursor= for more posts. */
export async function GET(req: Request, { params }: { params: Promise<{ handle: string }> }) {
  return handle(req, async (user) => {
    const profile = await profileView(user.id, decodeURIComponent((await params).handle));
    const posts = profile.canSeePosts ? await profilePosts(user.id, profile.id, new URL(req.url).searchParams.get("cursor")) : { items: [], next: null };
    return { profile, posts };
  });
}
