import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { MESSAGE_MAX } from "@/lib/social/rules";
import { liveMessageChanged } from "@/lib/realtime/social";
import { deleteMessage, editMessage } from "@/lib/social/service";

export const dynamic = "force-dynamic";

/** Edit your own message (within 24 hours). */
export async function PATCH(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const id = param((await params).id, uuidSchema);
    const input = await body(req, z.object({ body: z.string().min(1, "Type a message.").max(MESSAGE_MAX) }));
    await editMessage(user.id, id, input.body);
    liveMessageChanged(id);
    return { ok: true };
  });
}

/** Delete your own message for everyone. */
export async function DELETE(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const id = param((await params).id, uuidSchema);
    await deleteMessage(user.id, id);
    liveMessageChanged(id);
    return { ok: true };
  });
}
