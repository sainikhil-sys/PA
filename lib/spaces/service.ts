import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SPACE_CATEGORIES, type Space } from "@/lib/db/schema";
import type { User } from "@/lib/db/schema";
import { canSee, notHiddenBy } from "@/lib/feed/access";
import { requireSocial } from "@/lib/feed/people";
import { createPost, encodeCursor, getPost, type NewPost, PAGE } from "@/lib/feed/posts";
import { SocialError } from "@/lib/social/service";

/**
 * Spaces (B5): communities with roles (owner, moderator, member), join rules (open, by request,
 * by invite), public or private, all ages or adults only, optionally temporary. Who can read a
 * Space's posts is decided in lib/feed/access.ts (readsSpace), shared with every feed.
 */

export type Role = "owner" | "moderator" | "member";
export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 500;
export const RULES_MAX = 3000;

const s = schema.spaces;
const m = schema.spaceMembers;

// ---------- Rules ----------

export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const RESERVED = new Set(["new", "admin", "cowork", "settings", "invite", "explore", "discover", "help", "support", "official"]);

export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return "The address needs at least 3 letters or numbers.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "Use letters, numbers and single hyphens.";
  if (RESERVED.has(slug)) return "That address is reserved. Try another.";
  return null;
}

// ---------- Reading ----------

type Membership = { role: Role; status: "active" | "requested" | "banned" } | null;

async function membership(spaceId: string, userId: string): Promise<Membership> {
  const [row] = await db().select({ role: m.role, status: m.status }).from(m).where(and(eq(m.spaceId, spaceId), eq(m.userId, userId))).limit(1);
  return row ?? null;
}

async function viewerIsTeen(user: User) {
  return (await requireSocial(user)).group === "teen";
}

function readable(space: Space, me: Membership, teen: boolean) {
  if (space.status === "removed" || me?.status === "banned") return false;
  if (me?.status === "active") return true;
  return space.visibility === "public" && !(space.audience === "adults" && teen);
}

const isMod = (me: Membership) => me?.status === "active" && (me.role === "owner" || me.role === "moderator");
const isOpen = (space: Space) => space.status === "active" && !(space.expiresAt && space.expiresAt.getTime() <= Date.now());

async function loadSpace(user: User, slugOrId: string) {
  const [space] = await db()
    .select()
    .from(s)
    .where(/^[0-9a-f-]{36}$/.test(slugOrId) ? eq(s.id, slugOrId) : eq(s.slug, slugOrId.toLowerCase()))
    .limit(1);
  if (!space || space.status === "removed") throw new SocialError(404, "That Space doesn't exist, or was removed.");
  const [me, teen] = await Promise.all([membership(space.id, user.id), viewerIsTeen(user)]);
  // Private Spaces you're not in (or haven't asked to join), adults-only Spaces for teens and Spaces
  // you're banned from all look the same as a Space that doesn't exist.
  const hidden = me?.status === "banned" || (space.audience === "adults" && teen) || (space.visibility === "private" && !me);
  if (hidden) throw new SocialError(404, "That Space doesn't exist, or was removed.");
  return { space, me, teen };
}

function view(space: Space, me: Membership, teen: boolean) {
  return {
    id: space.id,
    slug: space.slug,
    name: space.name,
    description: space.description,
    rules: space.rules,
    category: space.category,
    visibility: space.visibility,
    joinPolicy: space.joinPolicy,
    audience: space.audience,
    memberCount: space.memberCount,
    expiresAt: space.expiresAt?.toISOString() ?? null,
    archived: !isOpen(space),
    myRole: me?.status === "active" ? me.role : null,
    myStatus: me?.status ?? null,
    canRead: readable(space, me, teen),
    canPost: me?.status === "active" && isOpen(space),
    canModerate: isMod(me),
  };
}

export async function getSpace(user: User, slugOrId: string) {
  const { space, me, teen } = await loadSpace(user, slugOrId);
  return view(space, me, teen);
}

/** Public Spaces to discover: by name or description, optionally one category; biggest first. */
export async function discoverSpaces(user: User, opts: { q?: string; category?: string; offset?: number } = {}) {
  const teen = await viewerIsTeen(user);
  const q = (opts.q ?? "").trim().slice(0, 60);
  const offset = Math.min(Math.max(opts.offset ?? 0, 0), 200);
  const rows = await db()
    .select()
    .from(s)
    .where(
      and(
        eq(s.status, "active"),
        eq(s.visibility, "public"),
        teen ? eq(s.audience, "all") : undefined,
        or(isNull(s.expiresAt), gt(s.expiresAt, new Date())),
        SPACE_CATEGORIES.includes(opts.category as (typeof SPACE_CATEGORIES)[number]) ? eq(s.category, opts.category as (typeof SPACE_CATEGORIES)[number]) : undefined,
        q ? or(ilike(s.name, `%${q.replace(/[%_\\]/g, "")}%`), ilike(s.description, `%${q.replace(/[%_\\]/g, "")}%`)) : undefined,
        sql`not exists (select 1 from ${m} b where b.space_id = ${s.id} and b.user_id = ${user.id} and b.status = 'banned')`,
      ),
    )
    .orderBy(desc(s.memberCount), desc(s.createdAt))
    .limit(PAGE)
    .offset(offset);
  const mine = rows.length ? await db().select().from(m).where(and(eq(m.userId, user.id), inArray(m.spaceId, rows.map((r) => r.id)))) : [];
  return {
    items: rows.map((r) => view(r, mine.find((x) => x.spaceId === r.id) ?? null, teen)),
    next: rows.length === PAGE ? String(offset + PAGE) : null,
  };
}

export async function mySpaces(user: User) {
  const teen = await viewerIsTeen(user);
  const rows = await db()
    .select({ space: s, role: m.role, status: m.status })
    .from(m)
    .innerJoin(s, eq(s.id, m.spaceId))
    .where(and(eq(m.userId, user.id), inArray(m.status, ["active", "requested"]), ne(s.status, "removed")))
    .orderBy(asc(s.name));
  return rows.map((r) => view(r.space, { role: r.role, status: r.status }, teen));
}

// ---------- Creating and settings ----------

export type SpaceInput = {
  name: string;
  slug?: string;
  description?: string;
  rules?: string;
  category?: (typeof SPACE_CATEGORIES)[number];
  visibility?: "public" | "private";
  joinPolicy?: "open" | "request" | "invite";
  audience?: "all" | "adults";
  expiresAt?: Date | null;
};

export async function createSpace(user: User, input: SpaceInput) {
  const me = await requireSocial(user);
  const name = input.name.trim();
  if (name.length < 3 || name.length > NAME_MAX) throw new SocialError(400, `Give the Space a name of 3 to ${NAME_MAX} characters.`);
  const slug = normalizeSlug(input.slug || name);
  const problem = slugProblem(slug);
  if (problem) throw new SocialError(400, problem);
  // Teens can make private Spaces for people they know; public communities are for adults to run.
  if (me.group === "teen" && (input.visibility ?? "public") === "public") throw new SocialError(403, "Under 18, you can create private Spaces. Make it private, then invite people.");
  if (me.group === "teen" && input.audience === "adults") throw new SocialError(403, "That Space would be adults only.");
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now() + 3600_000) throw new SocialError(400, "A temporary Space has to last at least an hour.");
  const visibility = input.visibility ?? "public";
  const joinPolicy = visibility === "private" && input.joinPolicy === "open" ? "request" : (input.joinPolicy ?? (visibility === "private" ? "invite" : "open"));
  const created = await db().transaction(async (tx) => {
    const [row] = await tx
      .insert(s)
      .values({
        slug,
        name,
        description: (input.description ?? "").trim().slice(0, DESCRIPTION_MAX),
        rules: (input.rules ?? "").trim().slice(0, RULES_MAX),
        category: input.category ?? "interest",
        visibility,
        joinPolicy,
        audience: input.audience ?? "all",
        createdBy: user.id,
        memberCount: 1,
        expiresAt: input.expiresAt ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return null;
    await tx.insert(m).values({ spaceId: row.id, userId: user.id, role: "owner", status: "active" });
    return row;
  });
  if (!created) throw new SocialError(409, "That address is taken. Try another.");
  return getSpace(user, created.id);
}

export async function updateSpace(user: User, spaceId: string, input: Partial<Omit<SpaceInput, "slug">> & { archived?: boolean }) {
  const { space, me } = await loadSpace(user, spaceId);
  if (me?.status !== "active" || me.role !== "owner") throw new SocialError(403, "Only the owner can change the Space's settings.");
  const set: Partial<typeof s.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 3 || name.length > NAME_MAX) throw new SocialError(400, `Give the Space a name of 3 to ${NAME_MAX} characters.`);
    set.name = name;
  }
  if (input.description !== undefined) set.description = input.description.trim().slice(0, DESCRIPTION_MAX);
  if (input.rules !== undefined) set.rules = input.rules.trim().slice(0, RULES_MAX);
  if (input.category !== undefined) set.category = input.category;
  if (input.joinPolicy !== undefined) set.joinPolicy = (input.visibility ?? space.visibility) === "private" && input.joinPolicy === "open" ? "request" : input.joinPolicy;
  if (input.visibility !== undefined) {
    if ((await viewerIsTeen(user)) && input.visibility === "public") throw new SocialError(403, "Under 18, your Spaces stay private.");
    set.visibility = input.visibility;
  }
  if (input.audience !== undefined) set.audience = input.audience;
  if (input.archived !== undefined) set.status = input.archived ? "archived" : "active";
  if (Object.keys(set).length) await db().update(s).set(set).where(eq(s.id, space.id));
  return getSpace(user, space.id);
}

// ---------- Membership ----------

async function bumpCount(spaceId: string, by: number) {
  await db().update(s).set({ memberCount: sql`greatest(${s.memberCount} + ${by}, 0)` }).where(eq(s.id, spaceId));
}

/** Join: open Spaces at once, request Spaces by request, invite Spaces only with a valid code. */
export async function joinSpace(user: User, spaceId: string, inviteCode?: string | null) {
  const me = await requireSocial(user);
  const [space] = await db().select().from(s).where(eq(s.id, spaceId)).limit(1);
  if (!space || space.status === "removed") throw new SocialError(404, "That Space doesn't exist, or was removed.");
  if (!isOpen(space)) throw new SocialError(409, "This Space is closed to new members.");
  if (space.audience === "adults" && me.group === "teen") throw new SocialError(404, "That Space doesn't exist, or was removed.");
  const current = await membership(space.id, user.id);
  if (current?.status === "banned") throw new SocialError(403, "You can't join this Space.");
  if (current?.status === "active") return getSpace(user, space.id);

  let status: "active" | "requested" = space.joinPolicy === "open" ? "active" : "requested";
  if (inviteCode) {
    const ok = await db()
      .update(schema.spaceInvites)
      .set({ uses: sql`${schema.spaceInvites.uses} + 1` })
      .where(
        and(
          eq(schema.spaceInvites.code, inviteCode),
          eq(schema.spaceInvites.spaceId, space.id),
          isNull(schema.spaceInvites.revokedAt),
          or(isNull(schema.spaceInvites.expiresAt), gt(schema.spaceInvites.expiresAt, new Date())),
          or(isNull(schema.spaceInvites.maxUses), sql`${schema.spaceInvites.uses} < ${schema.spaceInvites.maxUses}`),
        ),
      )
      .returning({ code: schema.spaceInvites.code });
    if (!ok.length) throw new SocialError(410, "That invite link has expired or been used up. Ask for a new one.");
    status = "active";
  } else if (space.joinPolicy === "invite") {
    throw new SocialError(403, "This Space is invite only. Ask a member for an invite link.");
  }
  await db()
    .insert(m)
    .values({ spaceId: space.id, userId: user.id, role: "member", status })
    .onConflictDoUpdate({ target: [m.spaceId, m.userId], set: { status, joinedAt: new Date() } });
  if (status === "active") await bumpCount(space.id, 1);
  return getSpace(user, space.id);
}

export async function leaveSpace(user: User, spaceId: string) {
  const me = await membership(spaceId, user.id);
  if (!me || me.status === "banned") return;
  if (me.role === "owner" && me.status === "active") {
    const [other] = await db()
      .select({ userId: m.userId })
      .from(m)
      .where(and(eq(m.spaceId, spaceId), eq(m.role, "owner"), eq(m.status, "active"), ne(m.userId, user.id)))
      .limit(1);
    if (!other) throw new SocialError(409, "Make someone else an owner before you leave.");
  }
  await db().delete(m).where(and(eq(m.spaceId, spaceId), eq(m.userId, user.id)));
  if (me.status === "active") await bumpCount(spaceId, -1);
}

async function requireMod(user: User, spaceId: string) {
  const me = await membership(spaceId, user.id);
  if (!isMod(me)) throw new SocialError(403, "Only the Space's owners and moderators can do that.");
  return me!;
}

export async function listMembers(user: User, spaceId: string, status: "active" | "requested" | "banned" = "active") {
  const { space, me, teen } = await loadSpace(user, spaceId);
  if (!readable(space, me, teen)) throw new SocialError(403, "Join this Space to see who's in it.");
  if (status !== "active" && !isMod(me)) throw new SocialError(403, "Only the Space's owners and moderators can see that.");
  return db()
    .select({ userId: m.userId, role: m.role, status: m.status, joinedAt: m.joinedAt, handle: schema.socialProfiles.handle, name: schema.socialProfiles.displayName, avatarUrl: schema.users.avatarUrl })
    .from(m)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, m.userId))
    .innerJoin(schema.users, eq(schema.users.id, m.userId))
    .where(and(eq(m.spaceId, space.id), eq(m.status, status)))
    .orderBy(sql`case ${m.role} when 'owner' then 0 when 'moderator' then 1 else 2 end`, asc(schema.socialProfiles.handle))
    .limit(500);
}

/** Moderators: accept or decline a join request; ban or unban; owners: change roles. */
export async function manageMember(user: User, spaceId: string, targetId: string, action: "accept" | "decline" | "ban" | "unban" | "make_moderator" | "make_member" | "make_owner" | "remove") {
  const me = await requireMod(user, spaceId);
  if (targetId === user.id) throw new SocialError(400, "You can't do that to yourself.");
  const target = await membership(spaceId, targetId);
  const where = and(eq(m.spaceId, spaceId), eq(m.userId, targetId));
  if (target?.role === "owner" && me.role !== "owner") throw new SocialError(403, "Moderators can't change an owner.");
  switch (action) {
    case "accept":
      if (target?.status !== "requested") throw new SocialError(404, "That request isn't there anymore.");
      await db().update(m).set({ status: "active", joinedAt: new Date() }).where(where);
      await bumpCount(spaceId, 1);
      return;
    case "decline":
      if (target?.status === "requested") await db().delete(m).where(where);
      return;
    case "remove":
      if (target?.status === "active") {
        await db().delete(m).where(where);
        await bumpCount(spaceId, -1);
      }
      return;
    case "ban":
      await db().insert(m).values({ spaceId, userId: targetId, role: "member", status: "banned" }).onConflictDoUpdate({ target: [m.spaceId, m.userId], set: { status: "banned", role: "member" } });
      if (target?.status === "active") await bumpCount(spaceId, -1);
      return;
    case "unban":
      if (target?.status === "banned") await db().delete(m).where(where);
      return;
    default: {
      if (me.role !== "owner") throw new SocialError(403, "Only owners can change roles.");
      if (target?.status !== "active") throw new SocialError(404, "That person isn't a member.");
      const role: Role = action === "make_owner" ? "owner" : action === "make_moderator" ? "moderator" : "member";
      await db().update(m).set({ role }).where(where);
    }
  }
}

// ---------- Invites ----------

export async function createInvite(user: User, spaceId: string, opts: { maxUses?: number | null; expiresInHours?: number | null } = {}) {
  await requireMod(user, spaceId);
  const code = randomBytes(9).toString("base64url");
  const expiresAt = opts.expiresInHours ? new Date(Date.now() + Math.min(opts.expiresInHours, 24 * 30) * 3600_000) : null;
  await db().insert(schema.spaceInvites).values({ code, spaceId, createdBy: user.id, maxUses: opts.maxUses ?? null, expiresAt });
  return { code, expiresAt: expiresAt?.toISOString() ?? null, maxUses: opts.maxUses ?? null };
}

export async function revokeInvite(user: User, spaceId: string, code: string) {
  await requireMod(user, spaceId);
  await db().update(schema.spaceInvites).set({ revokedAt: new Date() }).where(and(eq(schema.spaceInvites.code, code), eq(schema.spaceInvites.spaceId, spaceId)));
}

/** What an invite link opens, without joining: lets someone see the Space's name first. */
export async function inviteInfo(code: string) {
  const [row] = await db()
    .select({ space: s, invite: schema.spaceInvites })
    .from(schema.spaceInvites)
    .innerJoin(s, eq(s.id, schema.spaceInvites.spaceId))
    .where(eq(schema.spaceInvites.code, code))
    .limit(1);
  const inv = row?.invite;
  if (!row || inv!.revokedAt || (inv!.expiresAt && inv!.expiresAt.getTime() <= Date.now()) || (inv!.maxUses !== null && inv!.uses >= inv!.maxUses) || row.space.status !== "active") {
    throw new SocialError(410, "That invite link has expired or been used up. Ask for a new one.");
  }
  return { spaceId: row.space.id, slug: row.space.slug, name: row.space.name, description: row.space.description, memberCount: row.space.memberCount };
}

// ---------- Posts ----------

/** The Space's posts you may read: pinned first, then newest. */
export async function spacePosts(user: User, spaceId: string, cursor?: string | null) {
  const { space, me, teen } = await loadSpace(user, spaceId);
  if (!readable(space, me, teen)) return { items: [], next: null, pinned: [] };
  const p = schema.posts;
  const ids = await db()
    .select({ id: p.id, createdAt: p.createdAt, pinnedAt: p.pinnedAt })
    .from(p)
    .innerJoin(schema.users, eq(schema.users.id, p.authorId))
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, p.authorId))
    .where(and(eq(p.spaceId, space.id), canSee(user.id), notHiddenBy(user.id), cursorBefore(cursor)))
    .orderBy(desc(p.createdAt), desc(p.id))
    .limit(PAGE);
  const pinned = cursor
    ? []
    : await db()
        .select({ id: p.id })
        .from(p)
        .innerJoin(schema.users, eq(schema.users.id, p.authorId))
        .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, p.authorId))
        .where(and(eq(p.spaceId, space.id), isNotNull(p.pinnedAt), canSee(user.id)))
        .orderBy(desc(p.pinnedAt))
        .limit(3);
  const load = (list: { id: string }[]) => Promise.all(list.map((r) => getPost(user.id, r.id)));
  const pinnedSet = new Set(pinned.map((r) => r.id));
  return {
    pinned: await load(pinned),
    items: await load(ids.filter((r) => !pinnedSet.has(r.id))),
    next: ids.length === PAGE ? encodeCursor(ids[ids.length - 1]!.createdAt, ids[ids.length - 1]!.id) : null,
  };
}

function cursorBefore(c?: string | null) {
  if (!c) return undefined;
  const [at, id] = Buffer.from(c, "base64url").toString().split("|");
  const d = new Date(at ?? "");
  if (!id || Number.isNaN(d.getTime())) return undefined;
  return sql`(${schema.posts.createdAt} < ${d} or (${schema.posts.createdAt} = ${d} and ${schema.posts.id} < ${id}))`;
}

export async function postInSpace(user: User, spaceId: string, input: Omit<NewPost, "spaceId" | "visibility" | "mediaIds"> & { mediaIds?: string[] }) {
  const { space, me } = await loadSpace(user, spaceId);
  if (me?.status !== "active") throw new SocialError(403, "Join this Space to post in it.");
  if (!isOpen(space)) throw new SocialError(409, "This Space is read-only now.");
  if (input.kind === "announcement" && !isMod(me)) throw new SocialError(403, "Only owners and moderators can post announcements.");
  return createPost(user, { ...input, mediaIds: input.mediaIds ?? [], visibility: "public", spaceId: space.id });
}

/** Moderators: pin or unpin a post, or take it down in their Space. */
export async function moderatePost(user: User, postId: string, action: "pin" | "unpin" | "remove") {
  const p = schema.posts;
  const [post] = await db().select({ id: p.id, spaceId: p.spaceId }).from(p).where(and(eq(p.id, postId), isNull(p.deletedAt))).limit(1);
  if (!post?.spaceId) throw new SocialError(404, "That post isn't in a Space.");
  await requireMod(user, post.spaceId);
  if (action === "remove") await db().update(p).set({ status: "removed" }).where(eq(p.id, post.id));
  else await db().update(p).set({ pinnedAt: action === "pin" ? new Date() : null }).where(eq(p.id, post.id));
}

// ---------- Events ----------

const e = schema.spaceEvents;

export async function listEvents(user: User, spaceId: string, opts: { past?: boolean } = {}) {
  const { space, me, teen } = await loadSpace(user, spaceId);
  if (!readable(space, me, teen)) return [];
  const rows = await db()
    .select()
    .from(e)
    .where(and(eq(e.spaceId, space.id), opts.past ? sql`coalesce(${e.endsAt}, ${e.startsAt}) < now()` : sql`coalesce(${e.endsAt}, ${e.startsAt}) >= now()`))
    .orderBy(opts.past ? desc(e.startsAt) : asc(e.startsAt))
    .limit(50);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [counts, mine] = await Promise.all([
    db()
      .select({ eventId: schema.eventRsvps.eventId, status: schema.eventRsvps.status, n: sql<number>`count(*)::int` })
      .from(schema.eventRsvps)
      .where(inArray(schema.eventRsvps.eventId, ids))
      .groupBy(schema.eventRsvps.eventId, schema.eventRsvps.status),
    db().select().from(schema.eventRsvps).where(and(inArray(schema.eventRsvps.eventId, ids), eq(schema.eventRsvps.userId, user.id))),
  ]);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    location: r.location,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt?.toISOString() ?? null,
    cancelled: Boolean(r.cancelledAt),
    going: counts.find((c) => c.eventId === r.id && c.status === "going")?.n ?? 0,
    maybe: counts.find((c) => c.eventId === r.id && c.status === "maybe")?.n ?? 0,
    myRsvp: mine.find((x) => x.eventId === r.id)?.status ?? null,
  }));
}

export async function createEvent(user: User, spaceId: string, input: { title: string; description?: string; location?: string; startsAt: Date; endsAt?: Date | null }) {
  await requireMod(user, spaceId);
  const title = input.title.trim();
  if (title.length < 3 || title.length > 120) throw new SocialError(400, "Give the event a title of 3 to 120 characters.");
  if (input.startsAt.getTime() < Date.now() - 3600_000) throw new SocialError(400, "The event can't start in the past.");
  if (input.endsAt && input.endsAt <= input.startsAt) throw new SocialError(400, "The event has to end after it starts.");
  const [row] = await db()
    .insert(e)
    .values({ spaceId, createdBy: user.id, title, description: (input.description ?? "").trim().slice(0, 2000), location: (input.location ?? "").trim().slice(0, 300), startsAt: input.startsAt, endsAt: input.endsAt ?? null })
    .returning({ id: e.id });
  return row!.id;
}

export async function cancelEvent(user: User, eventId: string) {
  const [ev] = await db().select({ spaceId: e.spaceId }).from(e).where(eq(e.id, eventId)).limit(1);
  if (!ev) throw new SocialError(404, "That event isn't available.");
  await requireMod(user, ev.spaceId);
  await db().update(e).set({ cancelledAt: new Date() }).where(eq(e.id, eventId));
}

export async function rsvp(user: User, eventId: string, status: "going" | "maybe" | "not_going") {
  const [ev] = await db().select().from(e).where(eq(e.id, eventId)).limit(1);
  if (!ev || ev.cancelledAt) throw new SocialError(404, "That event isn't available.");
  const me = await membership(ev.spaceId, user.id);
  if (me?.status !== "active") throw new SocialError(403, "Join the Space to reply to its events.");
  await db()
    .insert(schema.eventRsvps)
    .values({ eventId, userId: user.id, status })
    .onConflictDoUpdate({ target: [schema.eventRsvps.eventId, schema.eventRsvps.userId], set: { status, updatedAt: new Date() } });
}
