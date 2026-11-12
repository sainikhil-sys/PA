import "server-only";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { db, schema } from "@/lib/db";
import { errMessage, log } from "@/lib/log";
import { sendPush } from "@/lib/push";
import {
  cleanBody,
  deliveryState,
  directKey,
  GROUP_MAX_MEMBERS,
  handleProblem,
  isFresh,
  normalizeHandle,
  ONLINE_TTL_MS,
  pair,
  previewText,
  REACTIONS,
  TYPING_TTL_MS,
  type ReactionKind,
  type ReportReason,
} from "./rules";

/**
 * Chats: profiles, friends, blocks and person-to-person threads. Every function takes the
 * signed-in person's id and checks access itself; routes never pass ids they have not checked.
 */

export class SocialError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const NOT_FOUND = "That chat no longer exists, or you're not in it.";

// ---------- Profiles ----------

export type PublicPerson = { id: string; handle: string; name: string; avatarUrl: string | null; online: boolean };

export async function getProfile(userId: string) {
  const [p] = await db().select().from(schema.socialProfiles).where(eq(schema.socialProfiles.userId, userId)).limit(1);
  return p ?? null;
}

async function requireProfile(userId: string) {
  const p = await getProfile(userId);
  if (!p) throw new SocialError(409, "Choose a handle first, so people can find you.");
  return p;
}

export async function saveProfile(
  userId: string,
  input: { handle?: string; displayName?: string; searchable?: boolean; showPresence?: boolean; readReceipts?: boolean; pushPreview?: boolean; privateAccount?: boolean },
) {
  const existing = await getProfile(userId);
  const handle = input.handle !== undefined ? normalizeHandle(input.handle) : existing?.handle;
  if (!handle) throw new SocialError(400, "Choose a handle.");
  const problem = input.handle !== undefined ? handleProblem(handle) : null;
  if (problem) throw new SocialError(400, problem);
  const displayName = (input.displayName ?? existing?.displayName ?? "").trim().slice(0, 60);
  if (!displayName) throw new SocialError(400, "Add the name people will see.");
  const values = {
    handle,
    displayName,
    searchable: input.searchable ?? existing?.searchable ?? true,
    showPresence: input.showPresence ?? existing?.showPresence ?? true,
    readReceipts: input.readReceipts ?? existing?.readReceipts ?? true,
    pushPreview: input.pushPreview ?? existing?.pushPreview ?? false,
    /** Posts only for approved followers. Teens are always treated as private by the feed (lib/safety). */
    privateAccount: input.privateAccount ?? existing?.privateAccount ?? false,
  };
  try {
    const [row] = await db()
      .insert(schema.socialProfiles)
      .values({ userId, ...values, lastActiveAt: new Date() })
      .onConflictDoUpdate({ target: schema.socialProfiles.userId, set: values })
      .returning();
    return row!;
  } catch (err) {
    // Drizzle wraps the Postgres error; the unique-violation detail is on its cause.
    const cause = (err as { cause?: unknown }).cause;
    if (/social_profiles_handle_idx/.test(`${errMessage(err)} ${cause ? errMessage(cause) : ""}`)) throw new SocialError(409, "That handle is taken. Try another.");
    throw err;
  }
}

/** Called on each poll while the app is open; at most one write per 30 seconds. */
export async function touchPresence(userId: string) {
  await db()
    .update(schema.socialProfiles)
    .set({ lastActiveAt: new Date() })
    .where(and(eq(schema.socialProfiles.userId, userId), or(isNull(schema.socialProfiles.lastActiveAt), lt(schema.socialProfiles.lastActiveAt, new Date(Date.now() - 30_000)))));
}

async function people(ids: string[], viewerId: string): Promise<Map<string, PublicPerson>> {
  const map = new Map<string, PublicPerson>();
  if (!ids.length) return map;
  const rows = await db()
    .select({ id: schema.users.id, avatarUrl: schema.users.avatarUrl, p: schema.socialProfiles })
    .from(schema.users)
    .innerJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, schema.users.id))
    .where(inArray(schema.users.id, [...new Set(ids)]));
  const friends = await friendIds(viewerId);
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      handle: r.p.handle,
      name: r.p.displayName,
      avatarUrl: r.avatarUrl,
      // Presence only between friends, and only when the person shares it.
      online: r.id !== viewerId && friends.has(r.id) && r.p.showPresence && isFresh(r.p.lastActiveAt, ONLINE_TTL_MS),
    });
  }
  return map;
}

// ---------- Relationships ----------

export type Relationship = "none" | "friends" | "outgoing" | "incoming" | "blocked" | "blocked_you";

async function friendIds(userId: string): Promise<Set<string>> {
  const rows = await db()
    .select({ low: schema.friendships.userLow, high: schema.friendships.userHigh })
    .from(schema.friendships)
    .where(and(eq(schema.friendships.status, "accepted"), or(eq(schema.friendships.userLow, userId), eq(schema.friendships.userHigh, userId))));
  return new Set(rows.map((r) => (r.low === userId ? r.high : r.low)));
}

/** Ids of people this person blocked or who blocked them; both are hidden from each other. */
async function blockedEitherWay(userId: string): Promise<Set<string>> {
  const rows = await db()
    .select()
    .from(schema.userBlocks)
    .where(or(eq(schema.userBlocks.blockerId, userId), eq(schema.userBlocks.blockedId, userId)));
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

export async function relationship(viewerId: string, otherId: string): Promise<Relationship> {
  const blocks = await db()
    .select()
    .from(schema.userBlocks)
    .where(
      or(
        and(eq(schema.userBlocks.blockerId, viewerId), eq(schema.userBlocks.blockedId, otherId)),
        and(eq(schema.userBlocks.blockerId, otherId), eq(schema.userBlocks.blockedId, viewerId)),
      ),
    );
  if (blocks.some((b) => b.blockerId === viewerId)) return "blocked";
  if (blocks.length) return "blocked_you";
  const { low, high } = pair(viewerId, otherId);
  const [f] = await db()
    .select()
    .from(schema.friendships)
    .where(and(eq(schema.friendships.userLow, low), eq(schema.friendships.userHigh, high)))
    .limit(1);
  if (!f) return "none";
  if (f.status === "accepted") return "friends";
  return f.requesterId === viewerId ? "outgoing" : "incoming";
}

/** Handle prefix or name search over people who allow it (friends are always findable). */
export async function searchPeople(viewerId: string, raw: string) {
  await requireProfile(viewerId);
  const q = normalizeHandle(raw).slice(0, 40);
  if (q.length < 2) return [];
  const like = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const friends = await friendIds(viewerId);
  const hidden = await blockedEitherWay(viewerId);
  const rows = await db()
    .select({ userId: schema.socialProfiles.userId, searchable: schema.socialProfiles.searchable })
    .from(schema.socialProfiles)
    .where(
      and(
        sql`${schema.socialProfiles.userId} <> ${viewerId}`,
        or(sql`${schema.socialProfiles.handle} like ${like}`, sql`lower(${schema.socialProfiles.displayName}) like ${`%${like}`}`),
      ),
    )
    .orderBy(schema.socialProfiles.handle)
    .limit(40);
  const ids = rows.filter((r) => !hidden.has(r.userId) && (r.searchable || friends.has(r.userId))).map((r) => r.userId).slice(0, 20);
  const map = await people(ids, viewerId);
  return Promise.all(ids.filter((id) => map.has(id)).map(async (id) => ({ ...map.get(id)!, relationship: await relationship(viewerId, id) })));
}

export async function listFriends(viewerId: string) {
  const rows = await db()
    .select()
    .from(schema.friendships)
    .where(or(eq(schema.friendships.userLow, viewerId), eq(schema.friendships.userHigh, viewerId)))
    .orderBy(desc(schema.friendships.createdAt));
  const hidden = await blockedEitherWay(viewerId);
  const other = (r: (typeof rows)[number]) => (r.userLow === viewerId ? r.userHigh : r.userLow);
  const visible = rows.filter((r) => !hidden.has(other(r)));
  const map = await people(visible.map(other), viewerId);
  const pick = (f: (r: (typeof rows)[number]) => boolean) =>
    visible
      .filter(f)
      .map((r) => map.get(other(r)))
      .filter((p): p is PublicPerson => Boolean(p));
  const friends = pick((r) => r.status === "accepted").sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return {
    friends,
    incoming: pick((r) => r.status === "pending" && r.requesterId !== viewerId),
    outgoing: pick((r) => r.status === "pending" && r.requesterId === viewerId),
  };
}

export type FriendAction = "request" | "accept" | "decline" | "cancel" | "remove";

export async function friendAction(viewerId: string, otherId: string, action: FriendAction): Promise<Relationship> {
  if (viewerId === otherId) throw new SocialError(400, "That's you.");
  await requireProfile(viewerId);
  if (!(await getProfile(otherId))) throw new SocialError(404, "That person isn't on Chats.");
  const rel = await relationship(viewerId, otherId);
  if (rel === "blocked") throw new SocialError(409, "Unblock this person first.");
  if (rel === "blocked_you") throw new SocialError(404, "That person isn't on Chats.");
  const { low, high } = pair(viewerId, otherId);
  const where = and(eq(schema.friendships.userLow, low), eq(schema.friendships.userHigh, high));
  switch (action) {
    case "request": {
      if (rel === "friends" || rel === "outgoing") return rel;
      // They already asked you: asking back accepts.
      if (rel === "incoming") return friendAction(viewerId, otherId, "accept");
      await db().insert(schema.friendships).values({ userLow: low, userHigh: high, requesterId: viewerId }).onConflictDoNothing();
      const me = await getProfile(viewerId);
      after(() => notifyPush(otherId, { title: "New friend request", body: `${me?.displayName ?? "Someone"} (@${me?.handle}) wants to connect.`, href: "/people?tab=requests", tag: `friend:${viewerId}` }));
      return "outgoing";
    }
    case "accept": {
      if (rel !== "incoming") throw new SocialError(409, rel === "friends" ? "You're already friends." : "There's no request to accept.");
      await db().update(schema.friendships).set({ status: "accepted", respondedAt: new Date() }).where(where);
      const me = await getProfile(viewerId);
      after(() => notifyPush(otherId, { title: "Friend request accepted", body: `${me?.displayName ?? "Someone"} accepted your request.`, href: "/chats", tag: `friend:${viewerId}` }));
      return "friends";
    }
    case "decline":
      if (rel !== "incoming") throw new SocialError(409, "There's no request to decline.");
      await db().delete(schema.friendships).where(where);
      return "none";
    case "cancel":
      if (rel !== "outgoing") throw new SocialError(409, "There's no request to cancel.");
      await db().delete(schema.friendships).where(where);
      return "none";
    case "remove":
      if (rel !== "friends") throw new SocialError(409, "You're not friends.");
      await db().delete(schema.friendships).where(where);
      return "none";
  }
}

export async function block(viewerId: string, otherId: string) {
  if (viewerId === otherId) throw new SocialError(400, "That's you.");
  await db().insert(schema.userBlocks).values({ blockerId: viewerId, blockedId: otherId }).onConflictDoNothing();
  // Blocking ends the friendship or request.
  const { low, high } = pair(viewerId, otherId);
  await db().delete(schema.friendships).where(and(eq(schema.friendships.userLow, low), eq(schema.friendships.userHigh, high)));
}

export async function unblock(viewerId: string, otherId: string) {
  await db().delete(schema.userBlocks).where(and(eq(schema.userBlocks.blockerId, viewerId), eq(schema.userBlocks.blockedId, otherId)));
}

export async function listBlocked(viewerId: string) {
  const rows = await db()
    .select({ id: schema.userBlocks.blockedId, handle: schema.socialProfiles.handle, name: schema.socialProfiles.displayName })
    .from(schema.userBlocks)
    .leftJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, schema.userBlocks.blockedId))
    .where(eq(schema.userBlocks.blockerId, viewerId))
    .orderBy(desc(schema.userBlocks.createdAt));
  return rows.map((r) => ({ id: r.id, handle: r.handle ?? "", name: r.name ?? "Former Cowork user" }));
}

// ---------- Threads ----------

async function membership(viewerId: string, threadId: string) {
  const [row] = await db()
    .select({ m: schema.dmMembers, t: schema.dmThreads })
    .from(schema.dmMembers)
    .innerJoin(schema.dmThreads, eq(schema.dmThreads.id, schema.dmMembers.threadId))
    .where(and(eq(schema.dmMembers.threadId, threadId), eq(schema.dmMembers.userId, viewerId), isNull(schema.dmMembers.leftAt)))
    .limit(1);
  if (!row) throw new SocialError(404, NOT_FOUND);
  return row;
}

async function currentMembers(threadId: string) {
  return db()
    .select({ m: schema.dmMembers, p: schema.socialProfiles })
    .from(schema.dmMembers)
    .leftJoin(schema.socialProfiles, eq(schema.socialProfiles.userId, schema.dmMembers.userId))
    .where(and(eq(schema.dmMembers.threadId, threadId), isNull(schema.dmMembers.leftAt)));
}

/** Finds or starts the one direct chat between two friends. */
export async function openDirect(viewerId: string, otherId: string): Promise<string> {
  if (viewerId === otherId) throw new SocialError(400, "That's you.");
  const rel = await relationship(viewerId, otherId);
  const key = directKey(viewerId, otherId);
  const [existing] = await db().select({ id: schema.dmThreads.id }).from(schema.dmThreads).where(eq(schema.dmThreads.directKey, key)).limit(1);
  if (existing) {
    if (rel === "blocked" || rel === "blocked_you") throw new SocialError(403, "You can't message this person.");
    // Re-joins a chat that was left (direct chats are never deleted for the other person).
    await db()
      .update(schema.dmMembers)
      .set({ leftAt: null })
      .where(and(eq(schema.dmMembers.threadId, existing.id), eq(schema.dmMembers.userId, viewerId)));
    return existing.id;
  }
  if (rel !== "friends") throw new SocialError(403, "You can message people after they accept your friend request.");
  return db().transaction(async (tx) => {
    const [t] = await tx.insert(schema.dmThreads).values({ kind: "direct", directKey: key, createdBy: viewerId }).onConflictDoNothing().returning({ id: schema.dmThreads.id });
    if (!t) {
      const [again] = await tx.select({ id: schema.dmThreads.id }).from(schema.dmThreads).where(eq(schema.dmThreads.directKey, key)).limit(1);
      return again!.id;
    }
    await tx.insert(schema.dmMembers).values([
      { threadId: t.id, userId: viewerId, role: "member" },
      { threadId: t.id, userId: otherId, role: "member" },
    ]);
    return t.id;
  });
}

/** Everyone added must be the creator's friend. */
async function requireFriends(viewerId: string, ids: string[]) {
  const friends = await friendIds(viewerId);
  const hidden = await blockedEitherWay(viewerId);
  const bad = ids.filter((id) => !friends.has(id) || hidden.has(id));
  if (bad.length) throw new SocialError(403, "You can only add friends to a group.");
}

export async function createGroup(viewerId: string, title: string, memberIds: string[]): Promise<string> {
  await requireProfile(viewerId);
  const ids = [...new Set(memberIds.filter((id) => id !== viewerId))];
  if (!ids.length) throw new SocialError(400, "Add at least one friend.");
  if (ids.length + 1 > GROUP_MAX_MEMBERS) throw new SocialError(400, `A group can have up to ${GROUP_MAX_MEMBERS} people.`);
  await requireFriends(viewerId, ids);
  const me = await getProfile(viewerId);
  return db().transaction(async (tx) => {
    const [t] = await tx.insert(schema.dmThreads).values({ kind: "group", title: title.trim().slice(0, 60), createdBy: viewerId, lastMessageAt: new Date() }).returning({ id: schema.dmThreads.id });
    await tx.insert(schema.dmMembers).values([{ threadId: t!.id, userId: viewerId, role: "owner" }, ...ids.map((userId) => ({ threadId: t!.id, userId, role: "member" as const }))]);
    await tx.insert(schema.dmMessages).values({ threadId: t!.id, senderId: null, clientId: `system:${crypto.randomUUID()}`, kind: "system", body: `${me!.displayName} created the group.` });
    return t!.id;
  });
}

async function systemMessage(threadId: string, body: string) {
  await db().insert(schema.dmMessages).values({ threadId, senderId: null, clientId: `system:${crypto.randomUUID()}`, kind: "system", body });
  await db().update(schema.dmThreads).set({ lastMessageAt: new Date() }).where(eq(schema.dmThreads.id, threadId));
}

export async function updateGroup(viewerId: string, threadId: string, change: { title?: string; add?: string[]; remove?: string; leave?: boolean; mute?: boolean }) {
  const { m, t } = await membership(viewerId, threadId);
  const me = await getProfile(viewerId);
  const name = me?.displayName ?? "Someone";
  if (change.mute !== undefined) {
    await db()
      .update(schema.dmMembers)
      .set({ mutedAt: change.mute ? new Date() : null })
      .where(and(eq(schema.dmMembers.threadId, threadId), eq(schema.dmMembers.userId, viewerId)));
  }
  if (change.leave) {
    await db()
      .update(schema.dmMembers)
      .set({ leftAt: new Date() })
      .where(and(eq(schema.dmMembers.threadId, threadId), eq(schema.dmMembers.userId, viewerId)));
    if (t.kind === "group") {
      await systemMessage(threadId, `${name} left the group.`);
      // The group keeps an owner: the longest-standing member takes over.
      if (m.role === "owner") {
        const [next] = await db()
          .select()
          .from(schema.dmMembers)
          .where(and(eq(schema.dmMembers.threadId, threadId), isNull(schema.dmMembers.leftAt)))
          .orderBy(schema.dmMembers.joinedAt)
          .limit(1);
        if (next) await db().update(schema.dmMembers).set({ role: "owner" }).where(and(eq(schema.dmMembers.threadId, threadId), eq(schema.dmMembers.userId, next.userId)));
      }
    }
    return;
  }
  if (t.kind !== "group" && (change.title !== undefined || change.add || change.remove)) throw new SocialError(400, "Only groups can be changed.");
  const manager = m.role === "owner" || m.role === "admin";
  if (change.title !== undefined) {
    const title = change.title.trim().slice(0, 60);
    if (!title) throw new SocialError(400, "Give the group a name.");
    await db().update(schema.dmThreads).set({ title }).where(eq(schema.dmThreads.id, threadId));
    await systemMessage(threadId, `${name} renamed the group to "${title}".`);
  }
  if (change.add?.length) {
    if (!manager) throw new SocialError(403, "Only the group's owner or admins can add people.");
    const ids = [...new Set(change.add.filter((id) => id !== viewerId))];
    await requireFriends(viewerId, ids);
    const count = (await currentMembers(threadId)).length;
    if (count + ids.length > GROUP_MAX_MEMBERS) throw new SocialError(400, `A group can have up to ${GROUP_MAX_MEMBERS} people.`);
    await db()
      .insert(schema.dmMembers)
      .values(ids.map((userId) => ({ threadId, userId, role: "member" as const })))
      .onConflictDoUpdate({ target: [schema.dmMembers.threadId, schema.dmMembers.userId], set: { leftAt: null, joinedAt: new Date(), role: "member" } });
    const added = await people(ids, viewerId);
    await systemMessage(threadId, `${name} added ${[...added.values()].map((p) => p.name).join(", ")}.`);
  }
  if (change.remove) {
    if (!manager) throw new SocialError(403, "Only the group's owner or admins can remove people.");
    const [target] = await db()
      .select()
      .from(schema.dmMembers)
      .where(and(eq(schema.dmMembers.threadId, threadId), eq(schema.dmMembers.userId, change.remove), isNull(schema.dmMembers.leftAt)));
    if (!target) throw new SocialError(404, "That person isn't in this group.");
    if (target.role === "owner") throw new SocialError(403, "The group's owner can't be removed.");
    await db()
      .update(schema.dmMembers)
      .set({ leftAt: new Date() })
      .where(and(eq(schema.dmMembers.threadId, threadId), eq(schema.dmMembers.userId, change.remove)));
    const removed = await getProfile(change.remove);
    await systemMessage(threadId, `${name} removed ${removed?.displayName ?? "someone"}.`);
  }
}

type ThreadRow = {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  last_message_at: Date | string | null;
  created_at: Date | string;
  read_seq: number | string;
  muted_at: Date | string | null;
  last_id: string | null;
  last_seq: number | string | null;
  last_body: string | null;
  last_kind: string | null;
  last_sender: string | null;
  last_deleted_at: Date | string | null;
  last_created_at: Date | string | null;
  unread: number | string;
  member_ids: string[];
  typing_ids: string[] | null;
};

/** The viewer's chats, newest activity first, with a preview, unread count and who is typing. */
export async function listThreads(viewerId: string) {
  await touchPresence(viewerId);
  // An ISO string with a cast: raw sql`` parameters can't be Date objects with postgres.js.
  const typingSince = new Date(Date.now() - TYPING_TTL_MS).toISOString();
  const rows = (await db().execute(sql`
    select t.id, t.kind, t.title, t.last_message_at, t.created_at, me.read_seq, me.muted_at,
      lm.id as last_id, lm.seq as last_seq, lm.body as last_body, lm.kind as last_kind, lm.sender_id as last_sender,
      lm.deleted_at as last_deleted_at, lm.created_at as last_created_at,
      (select count(*) from dm_messages u where u.thread_id = t.id and u.seq > me.read_seq and u.sender_id is distinct from ${viewerId} and u.kind = 'text' and u.deleted_at is null and (t.kind = 'direct' or u.created_at >= me.joined_at - interval '1 second')) as unread,
      (select coalesce(array_agg(o.user_id::text), '{}') from dm_members o where o.thread_id = t.id and o.left_at is null and o.user_id <> ${viewerId}) as member_ids,
      (select array_agg(o.user_id::text) from dm_members o where o.thread_id = t.id and o.left_at is null and o.user_id <> ${viewerId} and o.typing_at > ${typingSince}::timestamptz) as typing_ids
    from dm_members me
    join dm_threads t on t.id = me.thread_id
    left join lateral (select * from dm_messages m where m.thread_id = t.id and (t.kind = 'direct' or m.created_at >= me.joined_at - interval '1 second') order by m.seq desc limit 1) lm on true
    where me.user_id = ${viewerId} and me.left_at is null
    order by coalesce(t.last_message_at, t.created_at) desc
    limit 200
  `)) as unknown as ThreadRow[];
  // Mark everything listed as delivered to this phone.
  await db().execute(sql`
    update dm_members me set delivered_seq = sub.max_seq
    from (select m.thread_id, max(m.seq) as max_seq from dm_messages m join dm_members x on x.thread_id = m.thread_id and x.user_id = ${viewerId} and x.left_at is null group by m.thread_id) sub
    where me.thread_id = sub.thread_id and me.user_id = ${viewerId} and me.delivered_seq < sub.max_seq
  `);
  const hidden = await blockedEitherWay(viewerId);
  const ids = rows.flatMap((r) => r.member_ids ?? []);
  const map = await people([...ids, ...rows.map((r) => r.last_sender).filter((x): x is string => Boolean(x))], viewerId);
  return rows
    .filter((r) => !(r.kind === "direct" && (r.member_ids ?? []).some((id) => hidden.has(id))))
    .map((r) => {
      const members = (r.member_ids ?? []).map((id) => map.get(id)).filter((p): p is PublicPerson => Boolean(p));
      const other = r.kind === "direct" ? (members[0] ?? null) : null;
      const sender = r.last_sender ? map.get(r.last_sender) : undefined;
      return {
        id: r.id,
        kind: r.kind,
        title: r.kind === "group" ? r.title || members.map((m) => m.name).join(", ") || "Group" : (other?.name ?? "Former Cowork user"),
        other,
        memberCount: members.length + 1,
        online: r.kind === "direct" ? Boolean(other?.online) : members.some((m) => m.online),
        muted: Boolean(r.muted_at),
        unread: Number(r.unread),
        typing: (r.typing_ids ?? []).map((id) => map.get(id)?.name).filter(Boolean) as string[],
        updatedAt: new Date(r.last_created_at ?? r.last_message_at ?? r.created_at).toISOString(),
        preview: r.last_id
          ? previewText({ body: r.last_body ?? "", kind: r.last_kind ?? "text", deletedAt: r.last_deleted_at }, r.last_sender === viewerId, r.kind === "group" && sender ? sender.name.split(" ")[0]! : null)
          : null,
      };
    });
}

export type ThreadMessage = {
  id: string;
  seq: number;
  clientId: string;
  kind: "text" | "system";
  senderId: string | null;
  body: string;
  replyTo: { id: string; senderName: string; body: string } | null;
  reactions: { kind: ReactionKind; count: number; mine: boolean }[];
  editedAt: string | null;
  deleted: boolean;
  createdAt: string;
  state?: "sent" | "delivered" | "read";
};

/**
 * One page of a chat. `after` returns newer messages (polling); `before` returns older ones
 * (scrolling up). Reading a page marks it delivered for the viewer.
 */
export async function getThread(viewerId: string, threadId: string, opts: { after?: number; before?: number; limit?: number } = {}) {
  const { m, t } = await membership(viewerId, threadId);
  await touchPresence(viewerId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const conds = [eq(schema.dmMessages.threadId, threadId)];
  // Group members see what was said from when they joined; a direct chat shows its whole history.
  if (t.kind === "group") conds.push(gt(schema.dmMessages.createdAt, new Date(m.joinedAt.getTime() - 1000)));
  if (opts.after !== undefined) conds.push(gt(schema.dmMessages.seq, opts.after));
  if (opts.before !== undefined) conds.push(lt(schema.dmMessages.seq, opts.before));
  const rows = await db()
    .select()
    .from(schema.dmMessages)
    .where(and(...conds))
    .orderBy(opts.after !== undefined ? schema.dmMessages.seq : desc(schema.dmMessages.seq))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  if (opts.after === undefined) page.reverse();

  const members = await currentMembers(threadId);
  const me = members.find((x) => x.m.userId === viewerId);
  const others = members.filter((x) => x.m.userId !== viewerId);
  const viewerShares = me?.p?.readReceipts ?? true;

  const ids = page.map((r) => r.id);
  const replyIds = page.map((r) => r.replyToId).filter((x): x is string => Boolean(x));
  const [reactions, replies] = await Promise.all([
    ids.length ? db().select().from(schema.dmReactions).where(inArray(schema.dmReactions.messageId, ids)) : Promise.resolve([]),
    replyIds.length ? db().select().from(schema.dmMessages).where(and(inArray(schema.dmMessages.id, replyIds), eq(schema.dmMessages.threadId, threadId))) : Promise.resolve([]),
  ]);
  const senderIds = [...page.map((r) => r.senderId), ...replies.map((r) => r.senderId)].filter((x): x is string => Boolean(x));
  const map = await people([...senderIds, ...members.map((x) => x.m.userId)], viewerId);
  const replyMap = new Map(replies.map((r) => [r.id, r]));

  const maxSeq = page.reduce((a, r) => Math.max(a, r.seq), 0);
  if (maxSeq > m.deliveredSeq) {
    await db()
      .update(schema.dmMembers)
      .set({ deliveredSeq: maxSeq })
      .where(and(eq(schema.dmMembers.threadId, threadId), eq(schema.dmMembers.userId, viewerId), lt(schema.dmMembers.deliveredSeq, maxSeq)));
  }

  const marks = others.map((o) => ({ deliveredSeq: o.m.deliveredSeq, readSeq: o.m.readSeq, readReceipts: o.p?.readReceipts ?? false }));
  const messages: ThreadMessage[] = page.map((r) => {
    const reply = r.replyToId ? replyMap.get(r.replyToId) : undefined;
    const rx = REACTIONS.map((kind) => {
      const of = reactions.filter((x) => x.messageId === r.id && x.kind === kind);
      return { kind, count: of.length, mine: of.some((x) => x.userId === viewerId) };
    }).filter((x) => x.count > 0);
    return {
      id: r.id,
      seq: r.seq,
      clientId: r.clientId,
      kind: r.kind,
      senderId: r.senderId,
      body: r.deletedAt ? "" : r.body,
      replyTo: reply ? { id: reply.id, senderName: (reply.senderId && map.get(reply.senderId)?.name) || "Someone", body: reply.deletedAt ? "Message deleted" : reply.body.slice(0, 160) } : null,
      reactions: rx,
      editedAt: r.editedAt?.toISOString() ?? null,
      deleted: Boolean(r.deletedAt),
      createdAt: r.createdAt.toISOString(),
      state: r.senderId === viewerId ? deliveryState(r.seq, marks, viewerShares) : undefined,
    };
  });

  const typing = others.filter((o) => isFresh(o.m.typingAt, TYPING_TTL_MS)).map((o) => map.get(o.m.userId)?.name ?? "Someone");
  const otherPerson = t.kind === "direct" ? (others[0] ? (map.get(others[0].m.userId) ?? null) : null) : null;
  const rel = otherPerson ? await relationship(viewerId, otherPerson.id) : null;
  return {
    /** The viewer's own id, so the app can tell its own messages apart. */
    me: viewerId,
    thread: {
      id: t.id,
      kind: t.kind,
      title: t.kind === "group" ? t.title || others.map((o) => map.get(o.m.userId)?.name).join(", ") : (otherPerson?.name ?? "Former Cowork user"),
      other: otherPerson,
      /** Direct chats: whether a new message can be sent (only between current friends; never after a block). */
      canSend: t.kind === "group" || (rel === "friends" && others.length > 0),
      relationship: rel,
      myRole: m.role,
      muted: Boolean(m.mutedAt),
      readSeq: m.readSeq,
      members: members.map((x) => ({ ...(map.get(x.m.userId) ?? { id: x.m.userId, handle: "", name: "Former Cowork user", avatarUrl: null, online: false }), role: x.m.role })),
    },
    messages,
    hasMore: opts.after === undefined ? hasMore : false,
    typing,
  };
}

/** Sends a message. Re-sending the same clientId returns the first copy (no duplicates). */
export async function sendMessage(viewerId: string, threadId: string, input: { clientId: string; body: string; replyToId?: string | null }) {
  const { t } = await membership(viewerId, threadId);
  const body = cleanBody(input.body);
  if (!body) throw new SocialError(400, "Type a message.");
  if (t.kind === "direct") {
    // Includes a member who left: a direct chat always has the same two people.
    const all = await db().select({ userId: schema.dmMembers.userId }).from(schema.dmMembers).where(eq(schema.dmMembers.threadId, threadId));
    const otherId = all.find((x) => x.userId !== viewerId)?.userId ?? null;
    if (!otherId) throw new SocialError(403, "You can't message this person.");
    const rel = await relationship(viewerId, otherId);
    if (rel === "blocked") throw new SocialError(403, "You blocked this person. Unblock them to send messages.");
    if (rel === "blocked_you") throw new SocialError(403, "You can't message this person.");
    if (rel !== "friends") throw new SocialError(403, "You're not friends anymore. Send a friend request to message them again.");
    // A direct chat the other person left is reopened for them by a new message.
    await db().update(schema.dmMembers).set({ leftAt: null }).where(and(eq(schema.dmMembers.threadId, threadId), eq(schema.dmMembers.userId, otherId)));
  }
  let replyToId: string | null = null;
  if (input.replyToId) {
    const [r] = await db()
      .select({ id: schema.dmMessages.id })
      .from(schema.dmMessages)
      .where(and(eq(schema.dmMessages.id, input.replyToId), eq(schema.dmMessages.threadId, threadId)))
      .limit(1);
    replyToId = r?.id ?? null;
  }
  const [inserted] = await db()
    .insert(schema.dmMessages)
    .values({ threadId, senderId: viewerId, clientId: input.clientId, body, replyToId })
    .onConflictDoNothing({ target: [schema.dmMessages.senderId, schema.dmMessages.clientId] })
    .returning();
  const row =
    inserted ??
    (await db()
      .select()
      .from(schema.dmMessages)
      .where(and(eq(schema.dmMessages.senderId, viewerId), eq(schema.dmMessages.clientId, input.clientId)))
      .limit(1))[0]!;
  if (row.threadId !== threadId) throw new SocialError(409, "That message id was already used. Try again.");
  if (inserted) {
    await db().update(schema.dmThreads).set({ lastMessageAt: row.createdAt }).where(eq(schema.dmThreads.id, threadId));
    await db()
      .update(schema.dmMembers)
      .set({ readSeq: row.seq, deliveredSeq: row.seq, typingAt: null })
      .where(and(eq(schema.dmMembers.threadId, threadId), eq(schema.dmMembers.userId, viewerId)));
    after(() => notifyMembers(viewerId, threadId, t.kind, t.title, body));
  }
  return { id: row.id, seq: row.seq, clientId: row.clientId, createdAt: row.createdAt.toISOString() };
}

async function ownMessage(viewerId: string, messageId: string) {
  const [row] = await db().select().from(schema.dmMessages).where(eq(schema.dmMessages.id, messageId)).limit(1);
  if (!row) throw new SocialError(404, "That message no longer exists.");
  await membership(viewerId, row.threadId);
  return row;
}

const EDIT_WINDOW_MS = 24 * 60 * 60_000;

export async function editMessage(viewerId: string, messageId: string, input: string) {
  const row = await ownMessage(viewerId, messageId);
  if (row.senderId !== viewerId) throw new SocialError(403, "You can only edit your own messages.");
  if (row.deletedAt) throw new SocialError(409, "That message was deleted.");
  if (Date.now() - row.createdAt.getTime() > EDIT_WINDOW_MS) throw new SocialError(409, "Messages can be edited for 24 hours after sending.");
  const body = cleanBody(input);
  if (!body) throw new SocialError(400, "Type a message, or delete it instead.");
  await db().update(schema.dmMessages).set({ body, editedAt: new Date() }).where(eq(schema.dmMessages.id, messageId));
}

export async function deleteMessage(viewerId: string, messageId: string) {
  const row = await ownMessage(viewerId, messageId);
  if (row.senderId !== viewerId) throw new SocialError(403, "You can only delete your own messages.");
  await db().update(schema.dmMessages).set({ body: "", deletedAt: new Date() }).where(eq(schema.dmMessages.id, messageId));
  await db().delete(schema.dmReactions).where(eq(schema.dmReactions.messageId, messageId));
}

export async function toggleReaction(viewerId: string, messageId: string, kind: ReactionKind) {
  const row = await ownMessage(viewerId, messageId);
  if (row.deletedAt || row.kind === "system") throw new SocialError(409, "You can't react to that message.");
  const where = and(eq(schema.dmReactions.messageId, messageId), eq(schema.dmReactions.userId, viewerId), eq(schema.dmReactions.kind, kind));
  const removed = await db().delete(schema.dmReactions).where(where).returning();
  if (!removed.length) await db().insert(schema.dmReactions).values({ messageId, userId: viewerId, kind }).onConflictDoNothing();
  return !removed.length;
}

export async function markRead(viewerId: string, threadId: string, seq: number) {
  await membership(viewerId, threadId);
  await db()
    .update(schema.dmMembers)
    .set({ readSeq: sql`greatest(${schema.dmMembers.readSeq}, ${seq})`, deliveredSeq: sql`greatest(${schema.dmMembers.deliveredSeq}, ${seq})` })
    .where(and(eq(schema.dmMembers.threadId, threadId), eq(schema.dmMembers.userId, viewerId)));
}

export async function setTyping(viewerId: string, threadId: string, typing: boolean) {
  await membership(viewerId, threadId);
  await db()
    .update(schema.dmMembers)
    .set({ typingAt: typing ? new Date() : null })
    .where(and(eq(schema.dmMembers.threadId, threadId), eq(schema.dmMembers.userId, viewerId)));
}

/** Text search across the viewer's own chats (only messages sent while they were a member). */
export async function searchMessages(viewerId: string, raw: string) {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db()
    .select({ m: schema.dmMessages, t: schema.dmThreads })
    .from(schema.dmMessages)
    .innerJoin(schema.dmMembers, and(eq(schema.dmMembers.threadId, schema.dmMessages.threadId), eq(schema.dmMembers.userId, viewerId), isNull(schema.dmMembers.leftAt)))
    .innerJoin(schema.dmThreads, eq(schema.dmThreads.id, schema.dmMessages.threadId))
    .where(and(isNull(schema.dmMessages.deletedAt), eq(schema.dmMessages.kind, "text"), sql`${schema.dmMessages.body} ilike ${like}`, sql`(${schema.dmThreads.kind} = 'direct' or ${schema.dmMessages.createdAt} >= ${schema.dmMembers.joinedAt} - interval '1 second')`))
    .orderBy(desc(schema.dmMessages.seq))
    .limit(30);
  const map = await people(rows.map((r) => r.m.senderId).filter((x): x is string => Boolean(x)), viewerId);
  return rows.map((r) => ({
    threadId: r.t.id,
    messageId: r.m.id,
    title: r.t.kind === "group" ? r.t.title || "Group" : (r.m.senderId && r.m.senderId !== viewerId ? map.get(r.m.senderId)?.name : null) || "Direct chat",
    sender: r.m.senderId === viewerId ? "You" : ((r.m.senderId && map.get(r.m.senderId)?.name) ?? "Someone"),
    body: r.m.body.slice(0, 200),
    createdAt: r.m.createdAt.toISOString(),
  }));
}

// ---------- Reports ----------

export async function report(viewerId: string, input: { userId?: string | null; messageId?: string | null; threadId?: string | null; reason: ReportReason; details?: string | null }) {
  let targetUserId = input.userId ?? null;
  let snapshot: string | null = null;
  let threadId = input.threadId ?? null;
  if (input.messageId) {
    const row = await ownMessage(viewerId, input.messageId);
    if (row.senderId === viewerId) throw new SocialError(400, "You can't report your own message.");
    targetUserId = row.senderId;
    snapshot = row.body.slice(0, 4000);
    threadId = row.threadId;
  } else if (threadId) {
    await membership(viewerId, threadId);
  }
  if (!targetUserId && !threadId) throw new SocialError(400, "Say what you're reporting.");
  await db()
    .insert(schema.userReports)
    .values({ reporterId: viewerId, targetUserId, threadId, messageId: input.messageId ?? null, reason: input.reason, details: input.details?.trim().slice(0, 1000) || null, snapshot });
}

// ---------- Notifications ----------

async function notifyPush(userId: string, msg: { title: string; body: string; href: string; tag: string }) {
  try {
    await sendPush(userId, msg);
  } catch (err) {
    log.warn("social.push_failed", { error: errMessage(err) });
  }
}

/** New-message push to everyone else in the chat who hasn't muted it. Text only if they opted in. */
async function notifyMembers(senderId: string, threadId: string, kind: "direct" | "group", title: string | null, body: string) {
  try {
    const members = await currentMembers(threadId);
    const sender = members.find((x) => x.m.userId === senderId)?.p;
    const name = sender?.displayName ?? "Someone";
    await Promise.all(
      members
        .filter((x) => x.m.userId !== senderId && !x.m.mutedAt)
        .map((x) => {
          const preview = x.p?.pushPreview ? body.slice(0, 140) : "New message";
          const heading = kind === "group" ? (title ?? "Group") : name;
          return sendPush(x.m.userId, { title: heading, body: kind === "group" && x.p?.pushPreview ? `${name}: ${preview}` : preview, href: `/dm/${threadId}`, tag: `dm:${threadId}` });
        }),
    );
  } catch (err) {
    log.warn("social.push_failed", { error: errMessage(err) });
  }
}
