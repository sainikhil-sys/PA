import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { liveThread } from "@/lib/realtime/social";
import { markRead, setTyping } from "@/lib/social/service";

export const dynamic = "force-dynamic";

/**
 * Marks messages up to `seq` as read by you. Also carries the typing mark, so the app needs one
 * request for both while a chat is open.
 */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const id = param((await params).id, uuidSchema);
    const input = await body(req, z.object({ seq: z.number().int().min(0).optional(), typing: z.boolean().optional() }));
    if (input.seq !== undefined) await markRead(user.id, id, input.seq);
    if (input.typing !== undefined) await setTyping(user.id, id, input.typing);
    if (input.seq !== undefined) liveThread(id, { event: "dm.read", payload: { threadId: id, userId: user.id, readSeq: input.seq } }, { except: user.id });
    if (input.typing === true) liveThread(id, { event: "dm.typing", payload: { threadId: id, userId: user.id } }, { except: user.id });
    return { ok: true };
  });
}
