import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ageGroup } from "@/lib/safety/age";
import { relationship, SocialError } from "@/lib/social/service";
import { followState, personByHandle } from "./people";

/**
 * A person's public profile as another person sees it: handle, name, avatar, follower counts and
 * whether you can see their posts. The account's email, bio and date of birth are never included.
 */
export async function profileView(viewerId: string, handle: string) {
  const person = await personByHandle(handle);
  if (!person) throw new SocialError(404, "That person isn't on Cowork, or changed their handle.");
  const rel = await relationship(viewerId, person.id);
  if (rel === "blocked_you") throw new SocialError(404, "That person isn't on Cowork, or changed their handle.");
  const teen = (ageGroup(person.birthDate, new Date().toISOString().slice(0, 10)) ?? "adult") === "teen";
  const [state, followers, following] = await Promise.all([
    followState(viewerId, person.id),
    db().select({ n: count() }).from(schema.follows).where(and(eq(schema.follows.followeeId, person.id), eq(schema.follows.status, "accepted"))),
    db().select({ n: count() }).from(schema.follows).where(and(eq(schema.follows.followerId, person.id), eq(schema.follows.status, "accepted"))),
  ]);
  const [avatar] = await db().select({ avatarUrl: schema.users.avatarUrl }).from(schema.users).where(eq(schema.users.id, person.id)).limit(1);
  const privateAccount = teen || person.profile.privateAccount;
  return {
    id: person.id,
    handle: person.profile.handle,
    name: person.profile.displayName,
    avatarUrl: avatar?.avatarUrl ?? null,
    privateAccount,
    followState: state,
    friends: rel === "friends",
    blocked: rel === "blocked",
    followers: followers[0]?.n ?? 0,
    following: following[0]?.n ?? 0,
    canSeePosts: rel !== "blocked" && (state === "self" || state === "following" || !privateAccount),
  };
}

export async function listFollowRequests(viewerId: string) {
  return db()
    .select({ userId: schema.follows.followerId, handle: schema.socialProfiles.handle, name: schema.socialProfiles.displayName, avatarUrl: schema.users.avatarUrl, createdAt: schema.follows.createdAt })
    .from(schema.follows)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, schema.follows.followerId))
    .innerJoin(schema.users, eq(schema.users.id, schema.follows.followerId))
    .where(and(eq(schema.follows.followeeId, viewerId), eq(schema.follows.status, "requested")))
    .orderBy(desc(schema.follows.createdAt))
    .limit(100);
}
