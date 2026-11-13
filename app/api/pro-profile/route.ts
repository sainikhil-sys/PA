import { z } from "zod";
import { body, handle } from "@/lib/social/http";
import { myProProfile, OPEN_TO, saveProProfile } from "@/lib/startups/service";

export const dynamic = "force-dynamic";

/** Your professional profile (headline, skills, what you're open to), or null. */
export async function GET(req: Request) {
  return handle(req, async (user) => ({ profile: await myProProfile(user.id) }));
}

const schema = z.object({
  headline: z.string().max(120).optional(),
  about: z.string().max(2000).optional(),
  skills: z.array(z.string().max(40)).max(30).optional(),
  interests: z.array(z.string().max(40)).max(30).optional(),
  openTo: z.array(z.enum(OPEN_TO)).max(4).optional(),
  location: z.string().max(80).optional(),
  links: z.array(z.object({ label: z.string().max(40), url: z.string().max(300) })).max(5).optional(),
  visibility: z.enum(["everyone", "followers", "hidden"]).optional(),
});

/** Save it. 18+, behind the network.startups feature. */
export async function PUT(req: Request) {
  return handle(req, async (user) => ({ profile: await saveProProfile(user, await body(req, schema)) }));
}
