import { z } from "zod";
import { KEY_HEX, MAX_RESOLVE, resolveKeys } from "@/lib/connect/keys";
import { body, handle } from "@/lib/social/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  keys: z
    .array(z.string().trim().toLowerCase().regex(KEY_HEX, "That key isn't valid."))
    .min(1, "Send at least one key.")
    .max(MAX_RESOLVE, `Send up to ${MAX_RESOLVE} keys at a time.`),
});

/**
 * Which of these Connect keys belong to people who share a Space with you or are your friends.
 * Anyone else's keys (and anyone blocked either way) are simply not returned: {items}.
 */
export async function POST(req: Request) {
  return handle(req, async (user) => resolveKeys(user, (await body(req, schema)).keys));
}
