import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { requestVerification } from "@/lib/business/orgs";

export const dynamic = "force-dynamic";

/** Owners and admins: ask for verification (your sign-in email must be at the domain). */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { note } = await body(req, z.object({ note: z.string().max(1000).optional() }));
    await requestVerification(user, param((await params).id, uuidSchema), note ?? "");
    return { ok: true };
  });
}
