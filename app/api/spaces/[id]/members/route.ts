import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { listMembers, manageMember } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

/** Members (?status=requested or banned for moderators). */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const status = z.enum(["active", "requested", "banned"]).catch("active").parse(new URL(req.url).searchParams.get("status"));
    return { items: await listMembers(user, param((await params).id, uuidSchema), status) };
  });
}

const schema = z.object({
  userId: uuidSchema,
  action: z.enum(["accept", "decline", "ban", "unban", "make_moderator", "make_member", "make_owner", "remove"]),
});

/** Moderators: accept, decline, remove, ban, unban. Owners also change roles. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { userId, action } = await body(req, schema);
    await manageMember(user, param((await params).id, uuidSchema), userId, action);
    return { ok: true };
  });
}
