import { z } from "zod";
import { completeUpload } from "@/lib/media/uploads";
import { body, handle, param, uuidSchema, type IdParams } from "@/lib/social/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
  durationMs: z.number().int().positive().max(4 * 3600_000).optional(),
});

/** Confirm an upload once the PUT finished. The stored file must match the declared type and size. */
export async function POST(req: Request, { params }: IdParams) {
  return handle(req, async (user) => completeUpload(user.id, param((await params).id, uuidSchema), await body(req, schema)));
}
