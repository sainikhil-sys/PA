import { z } from "zod";
import { body, handle } from "@/lib/social/http";
import { suggestHandle } from "@/lib/social/rules";
import { getProfile, saveProfile } from "@/lib/social/service";

export const dynamic = "force-dynamic";

type Profile = NonNullable<Awaited<ReturnType<typeof getProfile>>>;
const view = (p: Profile) => ({ handle: p.handle, displayName: p.displayName, searchable: p.searchable, showPresence: p.showPresence, readReceipts: p.readReceipts, pushPreview: p.pushPreview });

/** The signed-in person's Chats profile, or a suggested handle when they haven't joined yet. */
export async function GET(req: Request) {
  return handle(req, async (user) => {
    const p = await getProfile(user.id);
    if (!p) return { profile: null, suggestion: { handle: suggestHandle(user.name || user.email), displayName: user.name ?? "" } };
    return { profile: view(p) };
  });
}

const schema = z.object({
  handle: z.string().max(40).optional(),
  displayName: z.string().max(60).optional(),
  searchable: z.boolean().optional(),
  showPresence: z.boolean().optional(),
  readReceipts: z.boolean().optional(),
  pushPreview: z.boolean().optional(),
});

/** Joins Chats (first save) or changes the profile and privacy switches. */
export async function PUT(req: Request) {
  return handle(req, async (user) => ({ profile: view(await saveProfile(user.id, await body(req, schema))) }));
}
