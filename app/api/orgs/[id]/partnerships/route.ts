import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { listPartnerships, requestPartnership } from "@/lib/business/orgs";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ items: await listPartnerships(user, param((await params).id, uuidSchema)) }));
}

/** Ask another organization to partner (yours must be verified). */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const { toOrgId, message } = await body(req, z.object({ toOrgId: uuidSchema, message: z.string().max(1000).optional() }));
    await requestPartnership(user, param((await params).id, uuidSchema), toOrgId, message ?? "");
    return { ok: true };
  });
}
