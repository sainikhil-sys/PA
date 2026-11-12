import { z } from "zod";
import { SPACE_CATEGORIES } from "@/lib/db/schema";
import { body, handle } from "@/lib/social/http";
import { DESCRIPTION_MAX, getSpace, NAME_MAX, RULES_MAX, updateSpace } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** A Space by id or address. Private Spaces you're not in answer 404. */
export async function GET(req: Request, { params }: Params) {
  return handle(req, async (user) => ({ space: await getSpace(user, decodeURIComponent((await params).id)) }));
}

const schema = z.object({
  name: z.string().max(NAME_MAX).optional(),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  rules: z.string().max(RULES_MAX).optional(),
  category: z.enum(SPACE_CATEGORIES).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  joinPolicy: z.enum(["open", "request", "invite"]).optional(),
  audience: z.enum(["all", "adults"]).optional(),
  archived: z.boolean().optional(),
});

/** Owners: change settings, or archive (read-only) and reopen. */
export async function PATCH(req: Request, { params }: Params) {
  return handle(req, async (user) => ({ space: await updateSpace(user, (await params).id, await body(req, schema)) }));
}
