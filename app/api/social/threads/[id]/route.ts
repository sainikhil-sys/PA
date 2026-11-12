import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { GROUP_TITLE_MAX } from "@/lib/social/rules";
import { liveThread } from "@/lib/realtime/social";
import { getThread, updateGroup } from "@/lib/social/service";

export const dynamic = "force-dynamic";

const cursor = z.coerce.number().int().min(0).optional();

/** A page of messages: ?after=<seq> for newer ones (polling), ?before=<seq> for older ones. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const id = param((await params).id, uuidSchema);
    const sp = new URL(req.url).searchParams;
    return getThread(user.id, id, {
      after: param(sp.get("after") ?? undefined, cursor),
      before: param(sp.get("before") ?? undefined, cursor),
    });
  });
}

const schema = z.object({
  title: z.string().max(GROUP_TITLE_MAX).optional(),
  add: z.array(uuidSchema).max(32).optional(),
  remove: uuidSchema.optional(),
  leave: z.boolean().optional(),
  mute: z.boolean().optional(),
});

/** Rename, add or remove people (owner and admins), mute, or leave. */
export async function PATCH(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const id = param((await params).id, uuidSchema);
    await updateGroup(user.id, id, await body(req, schema));
    liveThread(id, { event: "dm.updated", payload: { threadId: id } }, { includeLeft: true });
    return { ok: true };
  });
}
