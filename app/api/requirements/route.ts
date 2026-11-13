import { z } from "zod";
import { body, handle, uuidSchema } from "@/lib/social/http";
import { createRequirement, openRequirements } from "@/lib/business/deals";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Open requirements from verified buyers: ?q=&category=&offset= */
export async function GET(req: Request) {
  return handle(req, (user) => {
    const sp = new URL(req.url).searchParams;
    return openRequirements(user, { q: sp.get("q") ?? "", category: sp.get("category") ?? undefined, offset: Number(sp.get("offset") ?? 0) || 0 });
  });
}

const schema = z.object({
  orgId: uuidSchema,
  title: z.string().max(140),
  description: z.string().max(5000).optional(),
  category: z.string().max(60).optional(),
  quantity: z.string().max(120).optional(),
  budgetMinor: z.number().int().positive().nullish(),
  currency: z.string().length(3).optional(),
  deadline: z.coerce.date().nullish(),
});

/** Post a requirement for your verified organization. */
export async function POST(req: Request) {
  return handle(req, async (user) => {
    const { orgId, ...input } = await body(req, schema);
    return { id: await createRequirement(user, orgId, input) };
  });
}
