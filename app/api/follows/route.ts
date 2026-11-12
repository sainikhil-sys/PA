import { z } from "zod";
import { body, handle, uuidSchema } from "@/lib/social/http";
import { answerFollower, follow, followState, unfollow } from "@/lib/feed/people";
import { listFollowRequests } from "@/lib/feed/profiles";

export const dynamic = "force-dynamic";

/** People asking to follow you. */
export async function GET(req: Request) {
  return handle(req, async (user) => ({ requests: await listFollowRequests(user.id) }));
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("follow"), userId: uuidSchema }),
  z.object({ action: z.literal("unfollow"), userId: uuidSchema }),
  z.object({ action: z.literal("accept"), userId: uuidSchema }),
  z.object({ action: z.literal("decline"), userId: uuidSchema }),
]);

/** follow / unfollow someone; accept / decline (or remove) a follower. */
export async function POST(req: Request) {
  return handle(req, async (user) => {
    const input = await body(req, schema);
    if (input.action === "follow") return { state: await follow(user, input.userId) };
    if (input.action === "unfollow") await unfollow(user.id, input.userId);
    else await answerFollower(user.id, input.userId, input.action === "accept");
    return { state: await followState(user.id, input.userId) };
  });
}
