import { z } from "zod";
import { body, handle, uuidSchema } from "@/lib/social/http";
import { listCloseFriends, setCloseFriend } from "@/lib/moments/service";

export const dynamic = "force-dynamic";

/** Your close friends (private; they aren't told). */
export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await listCloseFriends(user.id) }));
}

/** {userId, on}: add or remove someone who follows you. */
export async function POST(req: Request) {
  return handle(req, async (user) => {
    const { userId, on } = await body(req, z.object({ userId: uuidSchema, on: z.boolean() }));
    await setCloseFriend(user.id, userId, on);
    return { ok: true };
  });
}
