import { z } from "zod";
import { body, handle, param, uuidSchema } from "@/lib/social/http";
import { getOrg, ORG_ROLES, updateOrg } from "@/lib/business/orgs";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** An organization by address (slug) or id, with its representatives and your role. */
export async function GET(req: Request, { params }: Params) {
  return handle(req, async (user) => ({ org: await getOrg(user, decodeURIComponent((await params).id)) }));
}

const schema = z.object({
  name: z.string().max(80).optional(),
  description: z.string().max(3000).optional(),
  industry: z.string().max(60).optional(),
  roles: z.array(z.enum(ORG_ROLES)).max(3).optional(),
  country: z.string().max(60).optional(),
  city: z.string().max(60).optional(),
  website: z.string().max(200).optional(),
});

/** Owners and admins: change the profile. The email domain can't change. */
export async function PATCH(req: Request, { params }: Params) {
  return handle(req, async (user) => {
    await updateOrg(user, param((await params).id, uuidSchema), await body(req, schema));
    return { ok: true };
  });
}
