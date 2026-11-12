import { z } from "zod";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";
import { createEvent, listEvents } from "@/lib/spaces/service";

export const dynamic = "force-dynamic";

/** Upcoming events (?past=1 for past ones), with reply counts and yours. */
export async function GET(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ items: await listEvents(user, param((await params).id, uuidSchema), { past: new URL(req.url).searchParams.get("past") === "1" }) }));
}

const schema = z.object({
  title: z.string().max(120),
  description: z.string().max(2000).optional(),
  location: z.string().max(300).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullish(),
});

/** Owners and moderators: add an event. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => ({ id: await createEvent(user, param((await params).id, uuidSchema), await body(req, schema)) }));
}
