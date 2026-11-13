import { z } from "zod";
import { body, handle } from "@/lib/social/http";
import { createStartup, discoverStartups, STAGES } from "@/lib/startups/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Public startups: ?q=&skill=&stage=&offset= */
export async function GET(req: Request) {
  return handle(req, (user) => {
    const sp = new URL(req.url).searchParams;
    return discoverStartups(user, { q: sp.get("q") ?? "", skill: sp.get("skill") ?? undefined, stage: sp.get("stage") ?? undefined, offset: Number(sp.get("offset") ?? 0) || 0 });
  });
}

const schema = z.object({
  name: z.string().max(60),
  oneLiner: z.string().max(160),
  description: z.string().max(5000).optional(),
  stage: z.enum(STAGES).optional(),
  industry: z.string().max(60).optional(),
  lookingFor: z.array(z.string().max(40)).max(10).optional(),
  skillsNeeded: z.array(z.string().max(40)).max(30).optional(),
  visibility: z.enum(["public", "private"]).optional(),
});

/** Publish a startup or idea; a private team Space is created with it. */
export async function POST(req: Request) {
  return handle(req, async (user) => ({ startup: await createStartup(user, await body(req, schema)) }));
}
