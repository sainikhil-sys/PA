import "server-only";
import { inArray, or, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { SocialError } from "@/lib/social/service";
import { getSpace } from "@/lib/spaces/service";

/**
 * Shared checks for the Connect parts of Spaces (notes and rooms). Every rule about who may see a
 * Space (removed, private, bans, adults only, the anonymous flag, email domains) lives in getSpace;
 * this adds what notes and rooms need on top.
 */

export type SpaceNeed = "read" | "write";

export const ANONYMOUS_REFUSAL = "Notes and rooms aren't available in anonymous Spaces, because they would show who is here.";

/**
 * The Space, if the person may use its notes and rooms. Reading needs active membership; writing
 * also needs the Space to be open (not archived or expired). Anything the person may not see is a
 * 404 from getSpace.
 */
export async function connectSpace(user: User, spaceId: string, need: SpaceNeed) {
  const space = await getSpace(user, spaceId);
  if (space.anonymous) throw new SocialError(403, ANONYMOUS_REFUSAL);
  if (space.myStatus !== "active" || !space.canRead) throw new SocialError(403, "Join this Space to see its notes and rooms.");
  if (need === "write" && !space.canPost) throw new SocialError(409, "This Space is read-only now.");
  return space;
}

/** Ids of people this person blocked or who blocked them. */
export async function blockedSet(userId: string): Promise<Set<string>> {
  const b = schema.userBlocks;
  const rows = await db()
    .select({ blockerId: b.blockerId, blockedId: b.blockedId })
    .from(b)
    .where(or(eq(b.blockerId, userId), eq(b.blockedId, userId)));
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

export const FALLBACK_NAME = "Cowork member";

/** Names shown to other members: the social display name. Never an email address. */
export async function displayNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const p = schema.socialProfiles;
  const rows = await db().select({ id: p.userId, name: p.displayName }).from(p).where(inArray(p.userId, ids));
  return new Map(rows.map((r) => [r.id, r.name?.trim() || FALLBACK_NAME]));
}

/** Postgres unique violation (Drizzle may wrap the driver error in `cause`). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
