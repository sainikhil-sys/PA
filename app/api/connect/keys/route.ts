import { z } from "zod";
import { KEY_HEX, myKeys, PROOF_HEX, registerKey, removeKey } from "@/lib/connect/keys";
import { rateLimit } from "@/lib/security/ratelimit";
import { body, handle, param } from "@/lib/social/http";
import { SocialError } from "@/lib/social/service";

export const dynamic = "force-dynamic";

/** Your registered Connect keys, plus what the app needs to prove a new one: {account, serverKey, items}. */
export async function GET(req: Request) {
  return handle(req, (user) => myKeys(user));
}

const schema = z.object({
  publicKey: z.string().trim().toLowerCase().regex(KEY_HEX, "That key isn't valid."),
  proof: z.string().trim().toLowerCase().regex(PROOF_HEX, "That proof isn't valid."),
  label: z.string().trim().max(40).default(""),
});

/** Registers this phone's Connect public key, with proof that the phone holds the private key. */
export async function POST(req: Request) {
  return handle(req, async (user) => {
    const rl = await rateLimit("auth", `connect-key:${user.id}`);
    if (!rl.success) throw new SocialError(429, "You're going a little fast. Wait a moment and try again.");
    return registerKey(user, await body(req, schema));
  });
}

/** Removes one of your keys: ?key=<hex>. */
export async function DELETE(req: Request) {
  return handle(req, async (user) => {
    const key = param((new URL(req.url).searchParams.get("key") ?? "").toLowerCase(), z.string().regex(KEY_HEX, "That key isn't valid."));
    return removeKey(user, key);
  });
}
