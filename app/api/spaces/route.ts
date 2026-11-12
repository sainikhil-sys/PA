import { z } from "zod";
import { SPACE_CATEGORIES } from "@/lib/db/schema";
import { body, handle } from "@/lib/social/http";
import { createSpace, DESCRIPTION_MAX, discoverSpaces, NAME_MAX, RULES_MAX } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

/** Public Spaces to discover: ?q=&category=&offset= */
export async function GET(req: Request) {
  return handle(req, async (user) => {
    const sp = new URL(req.url).searchParams;
    return discoverSpaces(user, { q: sp.get("q") ?? "", category: sp.get("category") ?? undefined, offset: Number(sp.get("offset") ?? 0) || 0 });
  });
}

const schema = z.object({
  name: z.string().max(NAME_MAX),
  slug: z.string().max(60).optional(),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  rules: z.string().max(RULES_MAX).optional(),
  category: z.enum(SPACE_CATEGORIES).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  joinPolicy: z.enum(["open", "request", "invite"]).optional(),
  audience: z.enum(["all", "adults"]).optional(),
  /** A temporary Space: becomes read-only after this time. */
  expiresAt: z.coerce.date().nullish(),
});

/** Create a Space; you become its owner. Under 18: private Spaces only. */
export async function POST(req: Request) {
  return handle(req, async (user) => ({ space: await createSpace(user, await body(req, schema)) }));
}
