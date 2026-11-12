import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { UserFacingError } from "@/lib/auth/action";
import { BRAND } from "@/lib/brand";
import { db, schema } from "@/lib/db";
import { RESTRICTABLE_FEATURES, type RestrictableFeature } from "@/lib/db/schema";
import { errorJson } from "@/lib/security/request";

/**
 * Per-feature restrictions set from the console (user_restrictions). Enforced by the API, not only
 * hidden in the UI: chat, uploads and automations call these before doing any work.
 * The messages never mention the console or who set the restriction.
 */

export { RESTRICTABLE_FEATURES, type RestrictableFeature };

export const FEATURE_LABEL: Record<RestrictableFeature, string> = {
  ai: "Assistant",
  uploads: "Uploads",
  automations: "Automations",
  connect: "Connect",
  community: "Community",
};

export const RESTRICTED_MESSAGE = `Your account can't use this right now. Contact ${BRAND.supportEmail}.`;
/** Same tone as lib/ai/messages.ts: one Cowork assistant, no internal detail. */
export const AI_RESTRICTED_MESSAGE = `${BRAND.name}'s assistant isn't available on your account right now. Contact ${BRAND.supportEmail}.`;

export function restrictedMessage(feature: RestrictableFeature): string {
  return feature === "ai" ? AI_RESTRICTED_MESSAGE : RESTRICTED_MESSAGE;
}

type RestrictionRow = { feature: RestrictableFeature; expiresAt: Date | null; liftedAt: Date | null };

/** A restriction counts until it is lifted or its expiry passes. Pure, so expiry handling is unit tested. */
export function isActiveRestriction(r: Pick<RestrictionRow, "expiresAt" | "liftedAt">, now: Date = new Date()): boolean {
  if (r.liftedAt) return false;
  return !r.expiresAt || r.expiresAt.getTime() > now.getTime();
}

export function activeFeatures(rows: readonly RestrictionRow[], now: Date = new Date()): Set<RestrictableFeature> {
  return new Set(rows.filter((r) => isActiveRestriction(r, now)).map((r) => r.feature));
}

/** One query per request for all of a person's restrictions, however many checks run. */
const loadActive = cache(async (userId: string): Promise<Set<RestrictableFeature>> => {
  const rows = await db()
    .select({ feature: schema.userRestrictions.feature, expiresAt: schema.userRestrictions.expiresAt, liftedAt: schema.userRestrictions.liftedAt })
    .from(schema.userRestrictions)
    .where(and(eq(schema.userRestrictions.userId, userId), isNull(schema.userRestrictions.liftedAt)));
  return activeFeatures(rows);
});

export async function isRestricted(userId: string, feature: RestrictableFeature): Promise<boolean> {
  return (await loadActive(userId)).has(feature);
}

/** For server actions: throws a message the action wrapper shows as is. */
export async function assertNotRestricted(userId: string, feature: RestrictableFeature): Promise<void> {
  if (await isRestricted(userId, feature)) throw new UserFacingError(restrictedMessage(feature));
}

/** For route handlers: a 403 with a plain message, or null when the feature is allowed. */
export async function restrictedResponse(userId: string, feature: RestrictableFeature): Promise<Response | null> {
  if (!(await isRestricted(userId, feature))) return null;
  return errorJson(403, restrictedMessage(feature), { code: "restricted" });
}
