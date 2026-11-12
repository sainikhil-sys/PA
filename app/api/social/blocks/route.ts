import { z } from "zod";
import { body, handle, uuidSchema } from "@/lib/social/http";
import { liveFriends } from "@/lib/realtime/social";
import { block, listBlocked, unblock } from "@/lib/social/service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await listBlocked(user.id) }));
}

const schema = z.object({ userId: uuidSchema, blocked: z.boolean() });

/** Block (also ends a friendship or request) or unblock someone. */
export async function POST(req: Request) {
  return handle(req, async (user) => {
    const { userId, blocked } = await body(req, schema);
    if (blocked) await block(user.id, userId);
    else await unblock(user.id, userId);
    liveFriends(user.id, userId);
    return { ok: true };
  });
}
