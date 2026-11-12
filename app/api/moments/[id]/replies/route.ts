import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { REPLY_MAX, repliesTo, respond } from "@/lib/moments/service";

export const dynamic = "force-dynamic";

/** Author only: replies and reactions. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ items: await repliesTo(user.id, param((await params).id, uuidSchema)) }));
}

const schema = z.object({ kind: z.enum(["reply", "reaction"]), body: z.string().max(REPLY_MAX) });

/** Reply privately or react. Only the Moment's author sees it. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await respond(user, param((await params).id, uuidSchema), await body(req, schema));
    return { ok: true };
  });
}
