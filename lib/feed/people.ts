import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { getSettings } from "@/lib/db/queries/settings";
import { type AgeGroup, ageGroup, todayIn } from "@/lib/safety/age";
import { relationship, SocialError } from "@/lib/social/service";

/** What posting, following and commenting need: a Chats handle and a date of birth on file. */
export async function requireSocial(user: User): Promise<{ handle: string; group: AgeGroup; privateAccount: boolean }> {
  if (!user.birthDate) throw new SocialError(403, "Add your date of birth first. Cowork asks once, and never shows it to anyone.");
  const [profile] = await db().select().from(schema.socialProfiles).where(eq(schema.socialProfiles.userId, user.id)).limit(1);
  if (!profile) throw new SocialError(403, "Choose a handle first. Open Chats to set up your profile.");
  const { timezone } = await getSettings(user.id);
  const group = ageGroup(user.birthDate, todayIn(timezone)) ?? "adult";
  // Teens are always private, whatever the stored setting says.
  return { handle: profile.handle, group, privateAccount: group === "teen" || profile.privateAccount };
}

export async function personByHandle(handle: string) {
  const [row] = await db()
    .select({ id: schema.users.id, birthDate: schema.users.birthDate, disabledAt: schema.users.disabledAt, profile: schema.socialProfiles })
    .from(schema.socialProfiles)
    .innerJoin(schema.users, eq(schema.users.id, schema.socialProfiles.userId))
    .where(eq(schema.socialProfiles.handle, handle.toLowerCase()))
    .limit(1);
  return row && !row.disabledAt ? row : null;
}

const isTeenBirthDate = (birthDate: string | null) => {
  if (!birthDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return (ageGroup(birthDate, today) ?? "adult") === "teen";
};

export type FollowState = "none" | "following" | "requested" | "self";

export async function followState(viewerId: string, targetId: string): Promise<FollowState> {
  if (viewerId === targetId) return "self";
  const [f] = await db()
    .select({ status: schema.follows.status })
    .from(schema.follows)
    .where(and(eq(schema.follows.followerId, viewerId), eq(schema.follows.followeeId, targetId)))
    .limit(1);
  return !f ? "none" : f.status === "accepted" ? "following" : "requested";
}

/**
 * Follow someone. Public adults: at once. Private accounts and teens: a request they approve.
 * An adult can only ask to follow a teen they are already friends with in Chats.
 */
export async function follow(viewer: User, targetId: string): Promise<FollowState> {
  const me = await requireSocial(viewer);
  if (targetId === viewer.id) throw new SocialError(400, "You can't follow yourself.");
  const rel = await relationship(viewer.id, targetId);
  if (rel === "blocked" || rel === "blocked_you") throw new SocialError(404, "That person isn't available.");
  const [target] = await db()
    .select({ birthDate: schema.users.birthDate, disabledAt: schema.users.disabledAt, privateAccount: schema.socialProfiles.privateAccount })
    .from(schema.users)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, schema.users.id))
    .where(eq(schema.users.id, targetId))
    .limit(1);
  if (!target || target.disabledAt) throw new SocialError(404, "That person isn't available.");
  const targetTeen = isTeenBirthDate(target.birthDate);
  if (targetTeen && me.group === "adult" && rel !== "friends") throw new SocialError(403, "You can follow this person once you're friends in Chats.");
  const status = targetTeen || target.privateAccount ? "requested" : "accepted";
  await db().insert(schema.follows).values({ followerId: viewer.id, followeeId: targetId, status }).onConflictDoNothing();
  return followState(viewer.id, targetId);
}

export async function unfollow(viewerId: string, targetId: string) {
  await db().delete(schema.follows).where(and(eq(schema.follows.followerId, viewerId), eq(schema.follows.followeeId, targetId)));
}

/** Accept or decline someone's request to follow you; or remove an existing follower. */
export async function answerFollower(viewerId: string, followerId: string, accept: boolean) {
  const where = and(eq(schema.follows.followerId, followerId), eq(schema.follows.followeeId, viewerId));
  if (accept) await db().update(schema.follows).set({ status: "accepted" }).where(and(where, eq(schema.follows.status, "requested")));
  else await db().delete(schema.follows).where(where);
}
