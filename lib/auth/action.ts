import "server-only";
import { z } from "zod";
import { maintenanceBlock } from "@/lib/config/enforce";
import type { User } from "@/lib/db/schema";
import { errMessage, log } from "@/lib/log";
import { rateLimit } from "@/lib/security/ratelimit";
import { getOwner } from "./session";

export type ActionResult<T = undefined> = ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };

/**
 * Wraps a server action: owner session required, rate limited, zod-validated
 * input, and errors converted to short human messages (details only in logs).
 */
export function ownerAction<S extends z.ZodType, R>(schema: S, fn: (input: z.infer<S>, user: User) => Promise<R>) {
  return async (input: z.input<S>): Promise<{ ok: true; data: R } | { ok: false; error: string; code?: "maintenance" }> => {
    const user = await getOwner();
    if (!user) return { ok: false, error: "Your session ended. Please sign in again." };
    const rl = await rateLimit("api", `action:${user.id}`);
    if (!rl.success) return { ok: false, error: "You're going a little fast. Try again in a moment." };
    // Maintenance mode: nothing changes for people without an admin role.
    const blocked = await maintenanceBlock(user);
    if (blocked) return { ok: false, error: blocked.message, code: "maintenance" };
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check your input." };
    try {
      return { ok: true, data: await fn(parsed.data, user) };
    } catch (err) {
      if (err instanceof UserFacingError) return { ok: false, error: err.message };
      log.error("action.failed", { error: errMessage(err) });
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  };
}

/** Throw this when the message is safe and useful to show the user. */
export class UserFacingError extends Error {}
