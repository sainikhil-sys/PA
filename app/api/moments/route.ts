import { z } from "zod";
import { body, handle, uuidSchema } from "@/lib/social/http";
import { BACKGROUNDS, BODY_MAX, createMoment, tray } from "@/lib/moments/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The tray: people with live Moments you may see (you first, then unseen). */
export async function GET(req: Request) {
  return handle(req, async (user) => ({ items: await tray(user.id) }));
}

const schema = z.object({
  mediaId: uuidSchema.nullish(),
  body: z.string().max(BODY_MAX).optional(),
  background: z.enum(BACKGROUNDS).nullish(),
  audience: z.enum(["followers", "close_friends"]).optional(),
});

/** Share a Moment for 24 hours: a photo or video (uploaded through /api/media), or text on a colour. */
export async function POST(req: Request) {
  return handle(req, async (user) => ({ moment: await createMoment(user, await body(req, schema)) }));
}
