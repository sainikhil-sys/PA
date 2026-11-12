import { z } from "zod";
import { body, handle, uuidSchema } from "@/lib/social/http";
import { liveFriends } from "@/lib/realtime/social";
import { friendAction, listFriends } from "@/lib/social/service";

export const dynamic = "force-dynamic";

/** Friends (online first), requests you received, and requests you sent. */
export async function GET(req: Request) {
  return handle(req, (user) => listFriends(user.id));
}

const schema = z.object({ userId: uuidSchema, action: z.enum(["request", "accept", "decline", "cancel", "remove"]) });

export async function POST(req: Request) {
  return handle(req, async (user) => {
    const { userId, action } = await body(req, schema);
    const relationship = await friendAction(user.id, userId, action);
    liveFriends(user.id, userId);
    return { relationship };
  });
}
