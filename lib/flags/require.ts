import "server-only";
import type { User } from "@/lib/db/schema";
import { errorJson } from "@/lib/security/request";
import { FLAGS } from "./registry";
import { flagContext, isFlagOn } from "./store";

export const FEATURE_OFF_MESSAGE = "This feature isn't available right now. Try again later.";

/**
 * For route handlers, after apiGuard: answers 403 { code: "feature_off" } when the flag is off for this
 * person, so a disabled feature is refused by the API, not just hidden.
 *
 *   const off = await requireFlag("chat.attachments", g.user, req);
 *   if (off) return off;
 */
export async function requireFlag(key: string, user: Pick<User, "id" | "createdAt" | "disabledAt">, req: Request): Promise<Response | null> {
  if (!FLAGS.has(key)) throw new Error(`Unknown feature flag: ${key}`);
  const on = await isFlagOn(key, await flagContext(user, req.headers));
  return on ? null : errorJson(403, FEATURE_OFF_MESSAGE, { code: "feature_off", message: FEATURE_OFF_MESSAGE });
}
