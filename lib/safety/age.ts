/**
 * Age rules (decision R6, 2026-11-12: 13+ from the start). Pure functions, shared by the website,
 * the API and tests. Dates are calendar dates ("YYYY-MM-DD"); no time zones involved.
 */
export const MIN_AGE = 13;
export const ADULT_AGE = 18;

export type AgeGroup = "teen" | "adult";

export const UNDER_AGE_MESSAGE = `You need to be at least ${MIN_AGE} to use Cowork, so this account has been deleted.`;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in "YYYY-MM-DD", or null. Rejects 2026-02-30 and the like. */
export function parseBirthDate(s: string): { y: number; m: number; d: number } | null {
  const hit = ISO.exec(s);
  if (!hit) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Completed years on `today` (a "YYYY-MM-DD" date in the person's time zone). */
export function ageOn(birth: string, today: string): number | null {
  const b = parseBirthDate(birth);
  const t = parseBirthDate(today);
  if (!b || !t) return null;
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age--;
  return age;
}

export type BirthDateCheck = { ok: true; group: AgeGroup } | { ok: false; reason: "invalid" | "future" | "implausible" | "under_age" };

export function checkBirthDate(birth: string, today: string): BirthDateCheck {
  const age = ageOn(birth, today);
  if (age === null) return { ok: false, reason: "invalid" };
  if (birth > today) return { ok: false, reason: "future" };
  if (age > 120) return { ok: false, reason: "implausible" };
  if (age < MIN_AGE) return { ok: false, reason: "under_age" };
  return { ok: true, group: age < ADULT_AGE ? "teen" : "adult" };
}

/** Teen or adult today; null when no date of birth is on file yet. */
export function ageGroup(birth: string | null | undefined, today: string): AgeGroup | null {
  if (!birth) return null;
  const age = ageOn(birth, today);
  if (age === null) return null;
  return age < ADULT_AGE ? "teen" : "adult";
}

/** Today's date in a time zone, as "YYYY-MM-DD". */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
