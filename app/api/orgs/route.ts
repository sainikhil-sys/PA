import { z } from "zod";
import { body, handle } from "@/lib/social/http";
import { createOrg, discoverOrgs, ORG_ROLES } from "@/lib/business/orgs";

export const dynamic = "force-dynamic";

/** Companies, suppliers and buyers: ?q=&role=&industry=&country=&offset= (verified first). */
export async function GET(req: Request) {
  return handle(req, (user) => {
    const sp = new URL(req.url).searchParams;
    return discoverOrgs(user, { q: sp.get("q") ?? "", role: sp.get("role") ?? undefined, industry: sp.get("industry") ?? undefined, country: sp.get("country") ?? undefined, offset: Number(sp.get("offset") ?? 0) || 0 });
  });
}

const schema = z.object({
  name: z.string().max(80),
  description: z.string().max(3000).optional(),
  industry: z.string().max(60).optional(),
  roles: z.array(z.enum(ORG_ROLES)).max(3).optional(),
  country: z.string().max(60).optional(),
  city: z.string().max(60).optional(),
  website: z.string().max(200).optional(),
  emailDomain: z.string().max(253),
});

/** Create an organization for your work-email domain; you become its owner. */
export async function POST(req: Request) {
  return handle(req, async (user) => ({ org: await createOrg(user, await body(req, schema)) }));
}
