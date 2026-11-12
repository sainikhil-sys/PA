import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { MESSAGE_MAX } from "@/lib/social/rules";
import { liveThread } from "@/lib/realtime/social";
import { sendMessage } from "@/lib/social/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** Made on the phone; a retried send with the same id never creates a second message. */
  clientId: z.string().regex(/^[\w-]{8,64}$/, "Something in that request wasn't valid."),
  body: z.string().min(1, "Type a message.").max(MESSAGE_MAX, `Messages can be up to ${MESSAGE_MAX} characters.`),
  replyToId: uuidSchema.nullish(),
});

export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const id = param((await params).id, uuidSchema);
    const sent = await sendMessage(user.id, id, await body(req, schema));
    liveThread(id, { event: "dm.message", payload: { threadId: id, seq: sent.seq } }, { except: user.id });
    return sent;
  });
}
