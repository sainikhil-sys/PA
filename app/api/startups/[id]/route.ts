import { z } from "zod";
import { body, handle, param, uuidSchema } from "@/lib/social/http";
import { getStartup, STAGES, updateStartup } from "@/lib/startups/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** A startup by its address (slug), with its team and your relation to it. */
export async function GET(req: Request, { params }: Params) {
  return handle(req, async (user) => ({ startup: await getStartup(user, decodeURIComponent((await params).id)) }));
}

const schema = z.object({
  name: z.string().max(60).optional(),
  oneLiner: z.string().max(160).optional(),
  description: z.string().max(5000).optional(),
  stage: z.enum(STAGES).optional(),
  industry: z.string().max(60).optional(),
  lookingFor: z.array(z.string().max(40)).max(10).optional(),
  skillsNeeded: z.array(z.string().max(40)).max(30).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  archived: z.boolean().optional(),
});

/** Founders: change it, or archive and reopen. */
export async function PATCH(req: Request, { params }: Params) {
  return handle(req, async (user) => {
    await updateStartup(user, param((await params).id, uuidSchema), await body(req, schema));
    return { ok: true };
  });
}
