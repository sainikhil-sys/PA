import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { enqueue } from "@/lib/jobs/queue";
import { r2Config, readUrl } from "@/lib/media/r2";
import { moderateText, reasonFor, type TextVerdict } from "@/lib/moderation/text";
import { REACTIONS, type ReactionKind, type ReportReason } from "@/lib/social/rules";
import { SocialError } from "@/lib/social/service";
import { canSee, effectivelyPublic, notHiddenBy } from "./access";
import { requireSocial } from "./people";

export const POST_MAX = 5000;
export const COMMENT_MAX = 2000;
export const MEDIA_PER_POST = 10;
export const PAGE = 20;
export type Visibility = "public" | "followers" | "friends";

const p = schema.posts;
const u = schema.users;
const sp = schema.socialProfiles;

// ---------- Reading ----------

/** Cursor for newest-first lists: "<iso time>|<id>". */
export function encodeCursor(at: Date, id: string) {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(c: string | null | undefined): { at: Date; id: string } | null {
  if (!c) return null;
  const [at, id] = Buffer.from(c, "base64url").toString().split("|");
  const d = new Date(at ?? "");
  return id && !Number.isNaN(d.getTime()) && /^[0-9a-f-]{36}$/.test(id) ? { at: d, id } : null;
}
const before = (c: { at: Date; id: string } | null) => (c ? or(lt(p.createdAt, c.at), and(eq(p.createdAt, c.at), lt(p.id, c.id))) : undefined);

const postColumns = {
  id: p.id,
  authorId: p.authorId,
  body: p.body,
  visibility: p.visibility,
  status: p.status,
  commentCount: p.commentCount,
  reactionCount: p.reactionCount,
  createdAt: p.createdAt,
  editedAt: p.editedAt,
  handle: sp.handle,
  name: sp.displayName,
  avatarUrl: u.avatarUrl,
};
type Row = {
  id: string;
  authorId: string;
  body: string;
  visibility: Visibility;
  status: "published" | "held" | "removed";
  commentCount: number;
  reactionCount: number;
  createdAt: Date;
  editedAt: Date | null;
  handle: string;
  name: string;
  avatarUrl: string | null;
};

function base() {
  return db().select(postColumns).from(p).innerJoin(u, eq(u.id, p.authorId)).innerJoin(sp, eq(sp.userId, p.authorId));
}

export type PostView = Awaited<ReturnType<typeof present>>[number];

/** Adds the author, media links and the viewer's own reactions and saves. */
async function present(viewerId: string, rows: Row[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [mediaRows, mine, saved] = await Promise.all([
    db()
      .select({ postId: schema.postMedia.postId, id: schema.media.id, kind: schema.media.kind, key: schema.media.key, width: schema.media.width, height: schema.media.height, position: schema.postMedia.position })
      .from(schema.postMedia)
      .innerJoin(schema.media, eq(schema.media.id, schema.postMedia.mediaId))
      .where(and(inArray(schema.postMedia.postId, ids), eq(schema.media.status, "ready"), sql`${schema.media.moderation} <> 'flagged'`))
      .orderBy(asc(schema.postMedia.position)),
    db()
      .select({ postId: schema.postReactions.postId, kind: schema.postReactions.kind })
      .from(schema.postReactions)
      .where(and(inArray(schema.postReactions.postId, ids), eq(schema.postReactions.userId, viewerId))),
    db()
      .select({ postId: schema.savedPosts.postId })
      .from(schema.savedPosts)
      .where(and(inArray(schema.savedPosts.postId, ids), eq(schema.savedPosts.userId, viewerId))),
  ]);
  const r2 = r2Config();
  const savedSet = new Set(saved.map((s) => s.postId));
  return rows.map((r) => ({
    id: r.id,
    author: { id: r.authorId, handle: r.handle, name: r.name, avatarUrl: r.avatarUrl },
    body: r.body,
    visibility: r.visibility,
    /** Only the author sees "held" (waiting for review). */
    status: r.authorId === viewerId ? r.status : "published",
    media: mediaRows.filter((m) => m.postId === r.id).map((m) => ({ id: m.id, kind: m.kind, width: m.width, height: m.height, url: r2 ? readUrl(r2, m.key) : null })),
    commentCount: r.commentCount,
    reactionCount: r.reactionCount,
    myReactions: mine.filter((m) => m.postId === r.id).map((m) => m.kind),
    saved: savedSet.has(r.id),
    mine: r.authorId === viewerId,
    createdAt: r.createdAt.toISOString(),
    editedAt: r.editedAt?.toISOString() ?? null,
  }));
}

function page(viewerId: string, rows: Row[]) {
  return present(viewerId, rows).then((items) => ({ items, next: rows.length === PAGE ? encodeCursor(rows[rows.length - 1]!.createdAt, rows[rows.length - 1]!.id) : null }));
}

export async function getPost(viewerId: string, postId: string) {
  const rows = await base().where(and(eq(p.id, postId), canSee(viewerId))).limit(1);
  if (!rows.length) throw new SocialError(404, "This post isn't available.");
  return (await present(viewerId, rows))[0]!;
}

/** People you follow, plus your own posts, newest first. */
export async function followingFeed(viewerId: string, cursor?: string | null) {
  const following = sql`(${p.authorId} = ${viewerId} or exists (select 1 from ${schema.follows} f where f.follower_id = ${viewerId} and f.followee_id = ${p.authorId} and f.status = 'accepted'))`;
  const rows = await base()
    .where(and(following, canSee(viewerId), notHiddenBy(viewerId), before(decodeCursor(cursor))))
    .orderBy(desc(p.createdAt), desc(p.id))
    .limit(PAGE);
  return page(viewerId, rows);
}

/**
 * For You: public posts from the last 14 days, ranked by real engagement and freshness
 * (reactions, comments, age in hours), never your own, hidden or blocked ones. Offset paging,
 * capped at 10 pages.
 */
export async function forYouFeed(viewerId: string, cursor?: string | null) {
  const offset = Math.min(Math.max(Number(cursor ?? 0) || 0, 0), PAGE * 9);
  const score = sql`(1 + ${p.reactionCount} * 2 + ${p.commentCount} * 3) / power(extract(epoch from (now() - ${p.createdAt})) / 3600 + 2, 1.5)`;
  const rows = await base()
    .where(and(effectivelyPublic, canSee(viewerId), notHiddenBy(viewerId), sql`${p.authorId} <> ${viewerId}`, gt(p.createdAt, sql`now() - interval '14 days'`)))
    .orderBy(desc(score), desc(p.createdAt))
    .limit(PAGE)
    .offset(offset);
  const items = await present(viewerId, rows);
  return { items, next: rows.length === PAGE && offset + PAGE < PAGE * 10 ? String(offset + PAGE) : null };
}

/** One person's posts that you're allowed to see. */
export async function profilePosts(viewerId: string, authorId: string, cursor?: string | null) {
  const rows = await base()
    .where(and(eq(p.authorId, authorId), canSee(viewerId), before(decodeCursor(cursor))))
    .orderBy(desc(p.createdAt), desc(p.id))
    .limit(PAGE);
  return page(viewerId, rows);
}

export async function savedFeed(viewerId: string, cursor?: string | null) {
  const rows = await base()
    .innerJoin(schema.savedPosts, and(eq(schema.savedPosts.postId, p.id), eq(schema.savedPosts.userId, viewerId)))
    .where(and(canSee(viewerId), before(decodeCursor(cursor))))
    .orderBy(desc(p.createdAt), desc(p.id))
    .limit(PAGE);
  return page(viewerId, rows);
}

// ---------- Writing ----------

/** Moderation outcome → stored status, plus a report for the console when flagged. */
async function applyVerdict(target: { postId?: string; commentId?: string; authorId: string; text: string }, v: TextVerdict) {
  if (v.verdict === "flagged") {
    await db()
      .insert(schema.userReports)
      .values({ reporterId: null, targetUserId: target.authorId, postId: target.postId ?? null, commentId: target.commentId ?? null, reason: reasonFor(v.categories), details: `Automatic check: ${v.categories.join(", ")}`, snapshot: target.text.slice(0, 4000) });
  }
  if (v.verdict === "unchecked") {
    await enqueue(target.authorId, "moderate_content", target.postId ? { postId: target.postId } : { commentId: target.commentId }, { dedupeKey: `moderate:${target.postId ?? target.commentId}` });
  }
}

export async function createPost(author: User, input: { body: string; visibility: Visibility; mediaIds: string[] }) {
  const me = await requireSocial(author);
  const body = input.body.trim();
  if (!body && !input.mediaIds.length) throw new SocialError(400, "Write something or add a photo.");
  if (body.length > POST_MAX) throw new SocialError(400, `Posts can be up to ${POST_MAX} characters.`);
  // Teens and private accounts can't post publicly; "public" becomes followers only.
  const visibility: Visibility = me.privateAccount && input.visibility === "public" ? "followers" : input.visibility;
  const mediaIds = [...new Set(input.mediaIds)].slice(0, MEDIA_PER_POST);
  if (mediaIds.length) {
    const owned = await db()
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(and(inArray(schema.media.id, mediaIds), eq(schema.media.userId, author.id), eq(schema.media.status, "ready"), sql`${schema.media.moderation} <> 'flagged'`));
    if (owned.length !== mediaIds.length) throw new SocialError(400, "One of those photos isn't ready yet. Wait for it to finish uploading.");
  }
  const verdict = body ? await moderateText(author.id, body) : ({ verdict: "ok" } as const);
  const [post] = await db()
    .insert(p)
    .values({ authorId: author.id, body, visibility, status: verdict.verdict === "flagged" ? "held" : "published" })
    .returning({ id: p.id });
  if (mediaIds.length) await db().insert(schema.postMedia).values(mediaIds.map((mediaId, position) => ({ postId: post!.id, mediaId, position })));
  await applyVerdict({ postId: post!.id, authorId: author.id, text: body }, verdict);
  return getPost(author.id, post!.id);
}

export async function editPost(author: User, postId: string, body: string) {
  const text = body.trim();
  if (text.length > POST_MAX) throw new SocialError(400, `Posts can be up to ${POST_MAX} characters.`);
  const [own] = await db().select({ id: p.id }).from(p).where(and(eq(p.id, postId), eq(p.authorId, author.id), isNull(p.deletedAt), sql`${p.status} <> 'removed'`)).limit(1);
  if (!own) throw new SocialError(404, "This post isn't available.");
  const verdict = text ? await moderateText(author.id, text) : ({ verdict: "ok" } as const);
  await db()
    .update(p)
    .set({ body: text, editedAt: new Date(), ...(verdict.verdict === "flagged" ? { status: "held" as const } : {}) })
    .where(eq(p.id, postId));
  await applyVerdict({ postId, authorId: author.id, text }, verdict);
  return getPost(author.id, postId);
}

export async function deletePost(authorId: string, postId: string) {
  const done = await db()
    .update(p)
    .set({ deletedAt: new Date(), body: "" })
    .where(and(eq(p.id, postId), eq(p.authorId, authorId), isNull(p.deletedAt)))
    .returning({ id: p.id });
  if (!done.length) throw new SocialError(404, "This post isn't available.");
}

export async function toggleReaction(viewer: User, postId: string, kind: ReactionKind): Promise<boolean> {
  await requireSocial(viewer);
  if (!REACTIONS.includes(kind)) throw new SocialError(400, "That reaction isn't available.");
  await getPost(viewer.id, postId);
  return db().transaction(async (tx) => {
    const removed = await tx
      .delete(schema.postReactions)
      .where(and(eq(schema.postReactions.postId, postId), eq(schema.postReactions.userId, viewer.id), eq(schema.postReactions.kind, kind)))
      .returning({ postId: schema.postReactions.postId });
    if (removed.length) {
      await tx.update(p).set({ reactionCount: sql`greatest(${p.reactionCount} - 1, 0)` }).where(eq(p.id, postId));
      return false;
    }
    await tx.insert(schema.postReactions).values({ postId, userId: viewer.id, kind });
    await tx.update(p).set({ reactionCount: sql`${p.reactionCount} + 1` }).where(eq(p.id, postId));
    return true;
  });
}

export async function toggleSave(viewerId: string, postId: string): Promise<boolean> {
  await getPost(viewerId, postId);
  const removed = await db()
    .delete(schema.savedPosts)
    .where(and(eq(schema.savedPosts.userId, viewerId), eq(schema.savedPosts.postId, postId)))
    .returning({ postId: schema.savedPosts.postId });
  if (removed.length) return false;
  await db().insert(schema.savedPosts).values({ userId: viewerId, postId }).onConflictDoNothing();
  return true;
}

export async function hidePost(viewerId: string, postId: string) {
  await db().insert(schema.hiddenPosts).values({ userId: viewerId, postId }).onConflictDoNothing();
}

// ---------- Comments ----------

const c = schema.comments;

export async function listComments(viewerId: string, postId: string, cursor?: string | null) {
  await getPost(viewerId, postId);
  const after = decodeCursor(cursor);
  const rows = await db()
    .select({ id: c.id, parentId: c.parentId, body: c.body, status: c.status, createdAt: c.createdAt, editedAt: c.editedAt, authorId: c.authorId, handle: sp.handle, name: sp.displayName, avatarUrl: u.avatarUrl })
    .from(c)
    .innerJoin(u, eq(u.id, c.authorId))
    .innerJoin(sp, eq(sp.userId, c.authorId))
    .where(
      and(
        eq(c.postId, postId),
        isNull(c.deletedAt),
        or(eq(c.authorId, viewerId), eq(c.status, "published")),
        sql`not exists (select 1 from ${schema.userBlocks} b where (b.blocker_id = ${viewerId} and b.blocked_id = ${c.authorId}) or (b.blocker_id = ${c.authorId} and b.blocked_id = ${viewerId}))`,
        after ? or(gt(c.createdAt, after.at), and(eq(c.createdAt, after.at), gt(c.id, after.id))) : undefined,
      ),
    )
    .orderBy(asc(c.createdAt), asc(c.id))
    .limit(PAGE);
  return {
    items: rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      body: r.body,
      status: r.authorId === viewerId ? r.status : "published",
      author: { id: r.authorId, handle: r.handle, name: r.name, avatarUrl: r.avatarUrl },
      mine: r.authorId === viewerId,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
    })),
    next: rows.length === PAGE ? encodeCursor(rows[rows.length - 1]!.createdAt, rows[rows.length - 1]!.id) : null,
  };
}

export async function addComment(author: User, postId: string, input: { body: string; parentId?: string | null }) {
  await requireSocial(author);
  await getPost(author.id, postId);
  const body = input.body.trim();
  if (!body) throw new SocialError(400, "Write a comment first.");
  if (body.length > COMMENT_MAX) throw new SocialError(400, `Comments can be up to ${COMMENT_MAX} characters.`);
  let parentId: string | null = null;
  if (input.parentId) {
    const [parent] = await db().select({ id: c.id, parentId: c.parentId }).from(c).where(and(eq(c.id, input.parentId), eq(c.postId, postId), isNull(c.deletedAt))).limit(1);
    if (!parent) throw new SocialError(404, "That comment isn't available.");
    parentId = parent.parentId ?? parent.id; // one level of replies
  }
  const verdict = await moderateText(author.id, body);
  const [row] = await db()
    .insert(c)
    .values({ postId, authorId: author.id, parentId, body, status: verdict.verdict === "flagged" ? "held" : "published" })
    .returning({ id: c.id });
  if (verdict.verdict !== "flagged") await db().update(p).set({ commentCount: sql`${p.commentCount} + 1` }).where(eq(p.id, postId));
  await applyVerdict({ commentId: row!.id, authorId: author.id, text: body }, verdict);
  return { id: row!.id, status: verdict.verdict === "flagged" ? "held" : "published" };
}

export async function deleteComment(viewerId: string, commentId: string) {
  // The comment's author, or the post's author, may remove it.
  const [row] = await db()
    .select({ id: c.id, postId: c.postId, authorId: c.authorId, status: c.status, postAuthor: p.authorId })
    .from(c)
    .innerJoin(p, eq(p.id, c.postId))
    .where(and(eq(c.id, commentId), isNull(c.deletedAt)))
    .limit(1);
  if (!row || (row.authorId !== viewerId && row.postAuthor !== viewerId)) throw new SocialError(404, "That comment isn't available.");
  await db().update(c).set({ deletedAt: new Date(), body: "" }).where(eq(c.id, commentId));
  if (row.status === "published") await db().update(p).set({ commentCount: sql`greatest(${p.commentCount} - 1, 0)` }).where(eq(p.id, row.postId));
}

// ---------- Reports ----------

export async function reportContent(viewerId: string, input: { postId?: string | null; commentId?: string | null; reason: ReportReason; details?: string | null }) {
  if (input.postId) {
    const post = await getPost(viewerId, input.postId);
    await db().insert(schema.userReports).values({ reporterId: viewerId, targetUserId: post.author.id, postId: post.id, reason: input.reason, details: input.details ?? null, snapshot: post.body.slice(0, 4000) });
    return;
  }
  if (input.commentId) {
    const [row] = await db().select({ id: c.id, postId: c.postId, authorId: c.authorId, body: c.body }).from(c).where(and(eq(c.id, input.commentId), isNull(c.deletedAt))).limit(1);
    if (!row) throw new SocialError(404, "That comment isn't available.");
    await getPost(viewerId, row.postId);
    await db().insert(schema.userReports).values({ reporterId: viewerId, targetUserId: row.authorId, commentId: row.id, reason: input.reason, details: input.details ?? null, snapshot: row.body.slice(0, 4000) });
    return;
  }
  throw new SocialError(400, "Choose what to report.");
}

// ---------- Moderation re-check (job) ----------

/** Re-runs moderation for content published while the AI was unavailable. Throws to retry later. */
export async function recheckContent(payload: { postId?: string; commentId?: string }) {
  const target = payload.postId
    ? (await db().select({ id: p.id, authorId: p.authorId, text: p.body }).from(p).where(and(eq(p.id, payload.postId), isNull(p.deletedAt))).limit(1))[0]
    : payload.commentId
      ? (await db().select({ id: c.id, authorId: c.authorId, text: c.body }).from(c).where(and(eq(c.id, payload.commentId), isNull(c.deletedAt))).limit(1))[0]
      : undefined;
  if (!target || !target.text) return "gone";
  const v = await moderateText(target.authorId, target.text, 20_000);
  if (v.verdict === "unchecked") throw new Error("moderation still unavailable");
  if (v.verdict === "flagged") {
    if (payload.postId) await db().update(p).set({ status: "held" }).where(eq(p.id, target.id));
    else {
      const [cm] = await db().update(c).set({ status: "held" }).where(and(eq(c.id, target.id), eq(c.status, "published"))).returning({ postId: c.postId });
      if (cm) await db().update(p).set({ commentCount: sql`greatest(${p.commentCount} - 1, 0)` }).where(eq(p.id, cm.postId));
    }
    await db()
      .insert(schema.userReports)
      .values({ reporterId: null, targetUserId: target.authorId, postId: payload.postId ?? null, commentId: payload.commentId ?? null, reason: reasonFor(v.categories), details: `Automatic check: ${v.categories.join(", ")}`, snapshot: target.text.slice(0, 4000) });
  }
  return v.verdict;
}
