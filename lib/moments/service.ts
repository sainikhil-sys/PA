import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { requireSocial } from "@/lib/feed/people";
import { r2Config, readUrl } from "@/lib/media/r2";
import { moderateText, reasonFor } from "@/lib/moderation/text";
import { REACTIONS } from "@/lib/social/rules";
import { SocialError } from "@/lib/social/service";

/**
 * Moments (B6): photos, videos or text that last 24 hours. Who sees one is decided here, in SQL,
 * for every read: the author always (also after it expires: their archive); others only while it
 * is live, published, not across a block, and only if they follow the author (accepted), or are
 * on the author's close-friends list when the audience is "close_friends". Media links are only
 * issued for Moments the reader may see, so an expired Moment's photo can't be fetched again.
 */

export const MOMENT_TTL_MS = 24 * 3600_000;
export const BODY_MAX = 500;
export const REPLY_MAX = 1000;
export const BACKGROUNDS = ["accent", "accent2", "surface", "text"] as const;

const mo = schema.moments;

function visibleTo(viewerId: string) {
  return sql`(${mo.deletedAt} is null and (${mo.authorId} = ${viewerId} or (
    ${mo.status} = 'published' and ${mo.expiresAt} > now()
    and not exists (select 1 from ${schema.userBlocks} b where (b.blocker_id = ${viewerId} and b.blocked_id = ${mo.authorId}) or (b.blocker_id = ${mo.authorId} and b.blocked_id = ${viewerId}))
    and exists (select 1 from ${schema.follows} f where f.follower_id = ${viewerId} and f.followee_id = ${mo.authorId} and f.status = 'accepted')
    and (${mo.audience} = 'followers' or exists (select 1 from ${schema.closeFriends} cf where cf.user_id = ${mo.authorId} and cf.friend_id = ${viewerId}))
  )))`;
}

const live = sql`(${mo.expiresAt} > now() and ${mo.deletedAt} is null)`;

export async function createMoment(user: User, input: { mediaId?: string | null; body?: string; background?: string | null; audience?: "followers" | "close_friends" }) {
  await requireSocial(user);
  const body = (input.body ?? "").trim();
  if (body.length > BODY_MAX) throw new SocialError(400, `Text can be up to ${BODY_MAX} characters.`);
  if (!input.mediaId && !body) throw new SocialError(400, "Add a photo, a video or some text.");
  const background = input.mediaId ? null : BACKGROUNDS.includes(input.background as (typeof BACKGROUNDS)[number]) ? input.background! : "accent";
  if (input.mediaId) {
    const [m] = await db()
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(and(eq(schema.media.id, input.mediaId), eq(schema.media.userId, user.id), eq(schema.media.status, "ready"), inArray(schema.media.kind, ["image", "video"]), sql`${schema.media.moderation} <> 'flagged'`))
      .limit(1);
    if (!m) throw new SocialError(400, "That photo or video isn't ready yet. Wait for it to finish uploading.");
  }
  const verdict = body ? await moderateText(user.id, body) : ({ verdict: "ok" } as const);
  const [row] = await db()
    .insert(mo)
    .values({ authorId: user.id, mediaId: input.mediaId ?? null, body, background, audience: input.audience ?? "followers", status: verdict.verdict === "flagged" ? "held" : "published", expiresAt: new Date(Date.now() + MOMENT_TTL_MS) })
    .returning({ id: mo.id, status: mo.status });
  if (verdict.verdict === "flagged") {
    await db().insert(schema.userReports).values({ reporterId: null, targetUserId: user.id, reason: reasonFor(verdict.categories), details: `Automatic check (Moment ${row!.id}): ${verdict.categories.join(", ")}`, snapshot: body.slice(0, 4000) });
  }
  return row!;
}

/** The row of avatars: people with live Moments you may see (you first), unseen ones next. */
export async function tray(viewerId: string) {
  const rows = await db()
    .select({
      authorId: mo.authorId,
      latest: sql<Date>`max(${mo.createdAt})`,
      count: sql<number>`count(*)::int`,
      unseen: sql<number>`count(*) filter (where not exists (select 1 from ${schema.momentViews} v where v.moment_id = ${mo.id} and v.viewer_id = ${viewerId}))::int`,
      handle: schema.socialProfiles.handle,
      name: schema.socialProfiles.displayName,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(mo)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, mo.authorId))
    .innerJoin(schema.users, eq(schema.users.id, mo.authorId))
    .where(and(live, visibleTo(viewerId)))
    .groupBy(mo.authorId, schema.socialProfiles.handle, schema.socialProfiles.displayName, schema.users.avatarUrl)
    .orderBy(sql`(${mo.authorId} = ${viewerId}) desc`, sql`(count(*) filter (where not exists (select 1 from ${schema.momentViews} v where v.moment_id = ${mo.id} and v.viewer_id = ${viewerId}))) > 0 desc`, desc(sql`max(${mo.createdAt})`))
    .limit(100);
  return rows.map((r) => ({ author: { id: r.authorId, handle: r.handle, name: r.name, avatarUrl: r.avatarUrl }, count: r.count, unseen: r.authorId === viewerId ? 0 : r.unseen, latest: new Date(r.latest).toISOString(), mine: r.authorId === viewerId }));
}

async function present(viewerId: string, rows: (typeof mo.$inferSelect)[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const mediaIds = rows.map((r) => r.mediaId).filter((x): x is string => Boolean(x));
  const [mediaRows, seen, viewCounts] = await Promise.all([
    mediaIds.length ? db().select().from(schema.media).where(and(inArray(schema.media.id, mediaIds), eq(schema.media.status, "ready"), sql`${schema.media.moderation} <> 'flagged'`)) : Promise.resolve([]),
    db().select({ momentId: schema.momentViews.momentId }).from(schema.momentViews).where(and(inArray(schema.momentViews.momentId, ids), eq(schema.momentViews.viewerId, viewerId))),
    db()
      .select({ momentId: schema.momentViews.momentId, n: sql<number>`count(*)::int` })
      .from(schema.momentViews)
      .where(inArray(schema.momentViews.momentId, ids))
      .groupBy(schema.momentViews.momentId),
  ]);
  const r2 = r2Config();
  return rows.map((r) => {
    const m = mediaRows.find((x) => x.id === r.mediaId);
    const mine = r.authorId === viewerId;
    return {
      id: r.id,
      authorId: r.authorId,
      body: r.body,
      background: r.background,
      audience: mine ? r.audience : undefined,
      status: mine ? r.status : "published",
      media: m ? { kind: m.kind, width: m.width, height: m.height, url: r2 ? readUrl(r2, m.key) : null } : null,
      seen: seen.some((x) => x.momentId === r.id),
      /** Only the author learns how many people saw it. */
      views: mine ? (viewCounts.find((x) => x.momentId === r.id)?.n ?? 0) : undefined,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      mine,
    };
  });
}

/** One person's live Moments you may see, oldest first (the order they're played). */
export async function momentsOf(viewerId: string, authorId: string) {
  const rows = await db()
    .select()
    .from(mo)
    .where(and(eq(mo.authorId, authorId), live, visibleTo(viewerId)))
    .orderBy(asc(mo.createdAt))
    .limit(100);
  return present(viewerId, rows);
}

/** Your own Moments, expired ones included, newest first. */
export async function archive(viewerId: string, before?: string | null) {
  const at = before ? new Date(before) : null;
  const rows = await db()
    .select()
    .from(mo)
    .where(and(eq(mo.authorId, viewerId), isNull(mo.deletedAt), at && !Number.isNaN(at.getTime()) ? lt(mo.createdAt, at) : undefined))
    .orderBy(desc(mo.createdAt))
    .limit(30);
  return { items: await present(viewerId, rows), next: rows.length === 30 ? rows[rows.length - 1]!.createdAt.toISOString() : null };
}

async function requireVisible(viewerId: string, momentId: string) {
  const [row] = await db().select().from(mo).where(and(eq(mo.id, momentId), live, visibleTo(viewerId))).limit(1);
  if (!row) throw new SocialError(404, "This Moment isn't available anymore.");
  return row;
}

export async function markViewed(viewerId: string, momentId: string) {
  const row = await requireVisible(viewerId, momentId);
  if (row.authorId === viewerId) return;
  await db().insert(schema.momentViews).values({ momentId, viewerId }).onConflictDoNothing();
}

/** Author only: who saw it, newest first. */
export async function viewers(authorId: string, momentId: string) {
  const [row] = await db().select({ authorId: mo.authorId }).from(mo).where(and(eq(mo.id, momentId), isNull(mo.deletedAt))).limit(1);
  if (!row || row.authorId !== authorId) throw new SocialError(404, "This Moment isn't available anymore.");
  return db()
    .select({ userId: schema.momentViews.viewerId, viewedAt: schema.momentViews.viewedAt, handle: schema.socialProfiles.handle, name: schema.socialProfiles.displayName, avatarUrl: schema.users.avatarUrl })
    .from(schema.momentViews)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, schema.momentViews.viewerId))
    .innerJoin(schema.users, eq(schema.users.id, schema.momentViews.viewerId))
    .where(eq(schema.momentViews.momentId, momentId))
    .orderBy(desc(schema.momentViews.viewedAt))
    .limit(500);
}

/** Reply privately, or react (one of the fixed reactions). The author sees it; nobody else does. */
export async function respond(viewer: User, momentId: string, input: { kind: "reply" | "reaction"; body: string }) {
  await requireSocial(viewer);
  const row = await requireVisible(viewer.id, momentId);
  if (row.authorId === viewer.id) throw new SocialError(400, "You can't reply to your own Moment.");
  const body = input.body.trim();
  if (input.kind === "reaction" && !REACTIONS.includes(body as (typeof REACTIONS)[number])) throw new SocialError(400, "That reaction isn't available.");
  if (input.kind === "reply") {
    if (!body) throw new SocialError(400, "Write a reply first.");
    if (body.length > REPLY_MAX) throw new SocialError(400, `Replies can be up to ${REPLY_MAX} characters.`);
    const v = await moderateText(viewer.id, body);
    if (v.verdict === "flagged") throw new SocialError(422, "That reply can't be sent. Keep it kind and within the rules.");
  }
  await db().insert(schema.momentReplies).values({ momentId, senderId: viewer.id, kind: input.kind, body });
}

/** Author only: replies and reactions to one Moment. */
export async function repliesTo(authorId: string, momentId: string) {
  const [row] = await db().select({ authorId: mo.authorId }).from(mo).where(and(eq(mo.id, momentId), isNull(mo.deletedAt))).limit(1);
  if (!row || row.authorId !== authorId) throw new SocialError(404, "This Moment isn't available anymore.");
  const r = schema.momentReplies;
  return db()
    .select({ id: r.id, kind: r.kind, body: r.body, createdAt: r.createdAt, senderId: r.senderId, handle: schema.socialProfiles.handle, name: schema.socialProfiles.displayName })
    .from(r)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, r.senderId))
    .where(
      and(
        eq(r.momentId, momentId),
        sql`not exists (select 1 from ${schema.userBlocks} b where (b.blocker_id = ${authorId} and b.blocked_id = ${r.senderId}) or (b.blocker_id = ${r.senderId} and b.blocked_id = ${authorId}))`,
      ),
    )
    .orderBy(asc(r.createdAt))
    .limit(500);
}

export async function deleteMoment(authorId: string, momentId: string) {
  const done = await db().update(mo).set({ deletedAt: new Date(), body: "" }).where(and(eq(mo.id, momentId), eq(mo.authorId, authorId), isNull(mo.deletedAt))).returning({ id: mo.id });
  if (!done.length) throw new SocialError(404, "This Moment isn't available anymore.");
}

// ---------- Close friends ----------

export async function listCloseFriends(userId: string) {
  return db()
    .select({ userId: schema.closeFriends.friendId, handle: schema.socialProfiles.handle, name: schema.socialProfiles.displayName, avatarUrl: schema.users.avatarUrl })
    .from(schema.closeFriends)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, schema.closeFriends.friendId))
    .innerJoin(schema.users, eq(schema.users.id, schema.closeFriends.friendId))
    .where(eq(schema.closeFriends.userId, userId))
    .orderBy(asc(schema.socialProfiles.handle))
    .limit(500);
}

/** Only people who follow you can be on the list (they'd see nothing otherwise). */
export async function setCloseFriend(userId: string, friendId: string, on: boolean) {
  if (friendId === userId) throw new SocialError(400, "You're always in your own Moments.");
  if (!on) {
    await db().delete(schema.closeFriends).where(and(eq(schema.closeFriends.userId, userId), eq(schema.closeFriends.friendId, friendId)));
    return;
  }
  const [f] = await db()
    .select({ status: schema.follows.status })
    .from(schema.follows)
    .where(and(eq(schema.follows.followerId, friendId), eq(schema.follows.followeeId, userId), eq(schema.follows.status, "accepted")))
    .limit(1);
  if (!f) throw new SocialError(400, "Only people who follow you can be on your close friends list.");
  await db().insert(schema.closeFriends).values({ userId, friendId }).onConflictDoNothing();
}

/** For the cleanup job: Moments their author deleted that still hold a media file. */
export async function expiredWithMedia(limit = 200) {
  return db()
    .select({ id: mo.id, mediaId: mo.mediaId })
    .from(mo)
    .where(and(sql`${mo.mediaId} is not null`, sql`${mo.deletedAt} is not null`))
    .limit(limit);
}

/**
 * Run by /api/cron/dispatch: deletes the photo or video of Moments their author deleted from
 * storage and marks the file removed. Expired Moments keep their file for the author's archive;
 * nobody else can get a link to it (see visibleTo). Without R2 configured it does nothing.
 */
export async function purgeExpiredMomentMedia(): Promise<number> {
  const cfg = r2Config();
  if (!cfg) return 0;
  const { deleteObject } = await import("@/lib/media/r2");
  const rows = await expiredWithMedia();
  let done = 0;
  for (const r of rows) {
    const [m] = await db().select({ id: schema.media.id, key: schema.media.key, status: schema.media.status }).from(schema.media).where(eq(schema.media.id, r.mediaId!)).limit(1);
    if (m && m.status !== "removed") {
      await deleteObject(cfg, m.key);
      await db().update(schema.media).set({ status: "removed" }).where(eq(schema.media.id, m.id));
    }
    await db().update(mo).set({ mediaId: null }).where(eq(mo.id, r.id));
    done++;
  }
  return done;
}
