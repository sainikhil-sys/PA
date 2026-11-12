import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { getSettings } from "@/lib/db/queries/settings";
import { log } from "@/lib/log";
import { type AgeGroup, checkBirthDate, todayIn, UNDER_AGE_MESSAGE } from "./age";

export type SetBirthDateResult =
  | { ok: true; group: AgeGroup }
  | { ok: false; status: 400 | 403 | 409; code: "invalid" | "under_age" | "already_set"; message: string };

const INVALID: Record<"invalid" | "future" | "implausible", string> = {
  invalid: "Enter your date of birth as a real date.",
  future: "That date is in the future. Enter your date of birth.",
  implausible: "Check the year of your date of birth.",
};

/**
 * Records a person's date of birth, once. Under 13: the account and everything in it is deleted
 * at once (nothing is kept), and the caller signs them out. Changing a date later goes through support,
 * so an age can't be edited to get around teen protections.
 */
export async function setBirthDate(user: User, birthDate: string): Promise<SetBirthDateResult> {
  if (user.birthDate) return { ok: false, status: 409, code: "already_set", message: "Your date of birth is already on file. To correct it, write to support." };
  const { timezone } = await getSettings(user.id);
  const check = checkBirthDate(birthDate, todayIn(timezone));
  if (!check.ok) {
    if (check.reason === "under_age") {
      await db().delete(schema.users).where(eq(schema.users.id, user.id));
      log.info("account.under_age_deleted");
      return { ok: false, status: 403, code: "under_age", message: UNDER_AGE_MESSAGE };
    }
    return { ok: false, status: 400, code: "invalid", message: INVALID[check.reason] };
  }
  await db().update(schema.users).set({ birthDate }).where(eq(schema.users.id, user.id));
  return { ok: true, group: check.group };
}
