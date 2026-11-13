import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { expressInterest, withdrawInterest } from "@/lib/startups/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Ask to join as a co-founder, collaborator or mentor, with a short note. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const input = await body(req, z.object({ kind: z.enum(["cofounder", "collaborate", "mentor"]), message: z.string().max(1000).optional() }));
    await expressInterest(user, param((await params).id, uuidSchema), input);
    return { ok: true };
  });
}

/** Withdraw your request. */
export async function DELETE(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    await withdrawInterest(user, param((await params).id, uuidSchema));
    return { ok: true };
  });
}
