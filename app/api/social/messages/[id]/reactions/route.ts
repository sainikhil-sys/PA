import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { REACTIONS } from "@/lib/social/rules";
import { liveMessageChanged } from "@/lib/realtime/social";
import { toggleReaction } from "@/lib/social/service";

export const dynamic = "force-dynamic";

/** Adds your reaction, or removes it if you already reacted that way. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const id = param((await params).id, uuidSchema);
    const { kind } = await body(req, z.object({ kind: z.enum(REACTIONS) }));
    const added = await toggleReaction(user.id, id, kind);
    liveMessageChanged(id);
    return { added };
  });
}
