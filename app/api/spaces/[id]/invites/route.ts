import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { createInvite, revokeInvite } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

const schema = z.object({ maxUses: z.number().int().min(1).max(1000).nullish(), expiresInHours: z.number().int().min(1).max(720).nullish() });

/** Moderators: a new invite link code. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ invite: await createInvite(user, param((await params).id, uuidSchema), await body(req, schema)) }));
}

/** Moderators: ?code= stops a link working. */
export async function DELETE(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await revokeInvite(user, param((await params).id, uuidSchema), new URL(req.url).searchParams.get("code") ?? "");
    return { ok: true };
  });
}
