import "server-only";
import { type SQL, sql } from "drizzle-orm";
import { schema } from "@/lib/db";

/**
 * Who may see a post, as SQL over `posts` joined to its author's `users` row and `social_profiles`
 * row. One definition, used by every feed and by single-post reads, so no query can leak a post
 * another path would hide.
 *
 * - The author always sees their own posts (also while held by moderation).
 * - Others never see held, removed or deleted posts, and never across a block (either direction).
 * Outside Spaces:
 * - "public" means everyone, except from private accounts and teens (13 to 17), where it means
 *   followers only. Teens are never public (decision R6).
 * - "followers": accepted followers. "friends": accepted Chats friends.
 * In a Space (posts.space_id set), the Space decides instead:
 * - active members always; anyone signed in when the Space is public, except: adults-only Spaces
 *   are closed to teens, a teen's posts are for members only, and people banned from the Space
 *   see nothing in it. Removed Spaces show nothing to anyone but the author.
 */

const p = schema.posts;
const u = schema.users;
const sp = schema.socialProfiles;

/** The author is 13 to 17 today (UTC date; the date of birth is never shown). */
export const authorIsTeen = sql`(${u.birthDate} is not null and ${u.birthDate} > (current_date - interval '18 years'))`;

const viewerIsTeen = (viewerId: string) =>
  sql`exists (select 1 from ${schema.users} vu where vu.id = ${viewerId} and vu.birth_date is not null and vu.birth_date > (current_date - interval '18 years'))`;

/** Visible to anyone signed in: public, outside Spaces, from a public adult account. */
export const effectivelyPublic = sql`(${p.spaceId} is null and ${p.visibility} = 'public' and not ${sp.privateAccount} and not ${authorIsTeen})`;

const blockedEitherWay = (viewerId: string) =>
  sql`exists (select 1 from ${schema.userBlocks} b where (b.blocker_id = ${viewerId} and b.blocked_id = ${p.authorId}) or (b.blocker_id = ${p.authorId} and b.blocked_id = ${viewerId}))`;

const followsAuthor = (viewerId: string) =>
  sql`exists (select 1 from ${schema.follows} f where f.follower_id = ${viewerId} and f.followee_id = ${p.authorId} and f.status = 'accepted')`;

const friendsWithAuthor = (viewerId: string) =>
  sql`exists (select 1 from ${schema.friendships} fr where fr.status = 'accepted' and fr.user_low = least(${viewerId}::uuid, ${p.authorId}) and fr.user_high = greatest(${viewerId}::uuid, ${p.authorId}))`;

/** The viewer may read the Space whose id is `spaceIdCol` (see the rules above). */
export function readsSpace(viewerId: string, spaceIdCol: SQL | typeof p.spaceId = p.spaceId): SQL {
  return sql`exists (select 1 from ${schema.spaces} s where s.id = ${spaceIdCol} and s.status <> 'removed'
    and not exists (select 1 from ${schema.spaceMembers} bm where bm.space_id = s.id and bm.user_id = ${viewerId} and bm.status = 'banned')
    and (
      exists (select 1 from ${schema.spaceMembers} m where m.space_id = s.id and m.user_id = ${viewerId} and m.status = 'active')
      or (s.visibility = 'public' and (s.audience = 'all' or not ${viewerIsTeen(viewerId)}))
    ))`;
}

const memberOfPostSpace = (viewerId: string) =>
  sql`exists (select 1 from ${schema.spaceMembers} m where m.space_id = ${p.spaceId} and m.user_id = ${viewerId} and m.status = 'active')`;

export function canSee(viewerId: string): SQL {
  return sql`(${p.deletedAt} is null and (${p.authorId} = ${viewerId} or (${p.status} = 'published' and not ${blockedEitherWay(viewerId)} and (
    (${p.spaceId} is null and (
      ${effectivelyPublic}
      or (${p.visibility} in ('public', 'followers') and ${followsAuthor(viewerId)})
      or (${p.visibility} = 'friends' and ${friendsWithAuthor(viewerId)})
    ))
    or (${p.spaceId} is not null and ${readsSpace(viewerId)} and (not ${authorIsTeen} or ${memberOfPostSpace(viewerId)}))
  ))))`;
}

/** Posts in public Spaces that anyone signed in may read: For You can suggest them. */
export const inPublicSpace = sql`(${p.spaceId} is not null and not ${authorIsTeen} and exists (select 1 from ${schema.spaces} s where s.id = ${p.spaceId} and s.visibility = 'public' and s.status = 'active'))`;

/** Posts in Spaces the viewer is an active member of (they appear in Following too). */
export const inMySpaces = (viewerId: string) => memberOfPostSpace(viewerId);

/** Posts this person chose not to see again. */
export const notHiddenBy = (viewerId: string) => sql`not exists (select 1 from ${schema.hiddenPosts} h where h.user_id = ${viewerId} and h.post_id = ${p.id})`;
