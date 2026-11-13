import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { addMember, removeMember } from "@/lib/business/orgs";

export const dynamic = "force-dynamic";

/** Owners and admins: add a representative by handle (their sign-in email must be at the domain). */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const input = await body(req, z.object({ handle: z.string().max(40), role: z.enum(["admin", "representative"]).optional(), title: z.string().max(80).optional() }));
    await addMember(user, param((await params).id, uuidSchema), input);
    return { ok: true };
  });
}

/** ?userId= : remove someone (or yourself). */
export async function DELETE(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await removeMember(user, param((await params).id, uuidSchema), param(new URL(req.url).searchParams.get("userId"), uuidSchema));
    return { ok: true };
  });
}
