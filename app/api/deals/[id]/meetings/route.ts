import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { scheduleMeeting } from "@/lib/business/deals";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => {
    const input = await body(req, z.object({ title: z.string().max(140), startsAt: z.coerce.date(), endsAt: z.coerce.date(), location: z.string().max(300).optional() }));
    return { id: await scheduleMeeting(user, param((await params).id, uuidSchema), input) };
  });
}
