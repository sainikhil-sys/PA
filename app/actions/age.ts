"use server";

import { z } from "zod";
import { ownerAction, UserFacingError } from "@/lib/auth/action";
import { signOutCurrent } from "@/lib/auth/session";
import { setBirthDate } from "@/lib/safety/birthdate";

/**
 * The website's date-of-birth step. Under 13, the account is deleted, the session ends and the
 * result says so, so the page can leave for the public home page.
 */
export const saveBirthDate = ownerAction(z.object({ birthDate: z.string().trim().max(10) }), async ({ birthDate }, user) => {
  const r = await setBirthDate(user, birthDate);
  if (r.ok) return { underAge: false as const };
  if (r.code === "under_age") {
    await signOutCurrent();
    return { underAge: true as const, message: r.message };
  }
  throw new UserFacingError(r.message);
});
