import { z } from "zod";
import { requireSocial } from "@/lib/feed/people";
import { startUpload } from "@/lib/media/uploads";
import { body, handle } from "@/lib/social/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.enum(["image", "video", "audio"]),
  contentType: z.string().max(60),
  sizeBytes: z.number().int().positive(),
});

/**
 * Start an upload: returns the media id and a signed link. PUT the file to `upload.url` with
 * exactly `upload.headers`, then POST /api/media/{id}/complete. 503 until storage is configured.
 */
export async function POST(req: Request) {
  return handle(req, async (user) => {
    await requireSocial(user);
    return startUpload(user.id, await body(req, schema));
  });
}
