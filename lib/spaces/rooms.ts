import "server-only";
import { and, count, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import type { SpaceRoom, User } from "@/lib/db/schema";
import { SocialError } from "@/lib/social/service";
import { blockedSet, connectSpace, displayNames, FALLBACK_NAME } from "@/lib/spaces/connect";
import { applyRoomAction, HEARTBEAT_MS, PRESENCE_TIDY_MS, PRESENT_WINDOW_MS, RoomRuleError, TIMER_MAX_MINUTES, timerView, type RoomAction } from "@/lib/spaces/room-rules";

/**
 * Rooms in a Space: focus rooms share a timer, listen-together rooms share a YouTube or Spotify link
 * and a start time (no audio passes through Cowork). Members see who chose to show they are here;
 * people who blocked each other never see each other's presence.
 */

export const MAX_ROOMS = 20;
export const ROOM_TITLE_MAX = 60;

export const roomCreateSchema = z.object({
  kind: z.enum(["focus", "listen"]),
  title: z.string().trim().min(1, "Give the room a name.").max(ROOM_TITLE_MAX, `Keep the name under ${ROOM_TITLE_MAX} characters.`),
});

export const roomActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), minutes: z.number().int().min(1, "Set at least 1 minute.").max(TIMER_MAX_MINUTES, `Set up to ${TIMER_MAX_MINUTES} minutes.`) }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("reset") }),
  z.object({ action: z.literal("media"), url: z.string().trim().min(1, "Paste a YouTube or Spotify link.").max(500) }),
  z.object({ action: z.literal("restart") }),
  z.object({ action: z.literal("clearMedia") }),
]);

export const presenceSchema = z.object({ consent: z.literal(true, { message: "Turn on Show that I'm here first." }) });

const r = schema.spaceRooms;
const p = schema.spaceRoomPresence;
const m = schema.spaceMembers;

/** Fresh presence rows of the Space's active members in these rooms. */
async function presentRows(spaceId: string, roomIds: string[], now: number) {
  if (!roomIds.length) return [];
  return db()
    .select({ roomId: p.roomId, userId: p.userId })
    .from(p)
    .innerJoin(m, and(eq(m.spaceId, spaceId), eq(m.userId, p.userId), eq(m.status, "active")))
    .where(and(inArray(p.roomId, roomIds), gt(p.lastSeenAt, new Date(now - PRESENT_WINDOW_MS))));
}

/** What every member sees: the shared timer, the shared link, and who chose to show they are here. */
export async function roomView(room: SpaceRoom, viewerId: string) {
  const now = Date.now();
  const [rows, blocked] = await Promise.all([presentRows(room.spaceId, [room.id], now), blockedSet(viewerId)]);
  const present = rows.filter((x) => !blocked.has(x.userId));
  const names = await displayNames(present.map((x) => x.userId));
  return {
    id: room.id,
    kind: room.kind,
    title: room.title,
    serverNow: new Date(now).toISOString(),
    timer: timerView(room, now),
    media: room.mediaUrl && room.mediaKind ? { url: room.mediaUrl, kind: room.mediaKind, startAt: room.mediaStartAt?.toISOString() ?? null } : null,
    present: present.map((x) => ({ userId: x.userId, name: names.get(x.userId) ?? FALLBACK_NAME, isMe: x.userId === viewerId })),
    heartbeatMs: HEARTBEAT_MS,
    mine: room.createdBy === viewerId,
  };
}

async function loadRoom(spaceId: string, roomId: string) {
  const [room] = await db()
    .select()
    .from(r)
    .where(and(eq(r.id, roomId), eq(r.spaceId, spaceId)))
    .limit(1);
  if (!room) throw new SocialError(404, "That room no longer exists.");
  return room;
}

export async function listRooms(user: User, spaceId: string) {
  const space = await connectSpace(user, spaceId, "read");
  const rooms = await db().select().from(r).where(eq(r.spaceId, space.id)).orderBy(desc(r.updatedAt)).limit(MAX_ROOMS);
  if (!rooms.length) return [];
  const now = Date.now();
  const [rows, blocked] = await Promise.all([
    presentRows(
      space.id,
      rooms.map((x) => x.id),
      now,
    ),
    blockedSet(user.id),
  ]);
  return rooms.map((x) => ({
    id: x.id,
    kind: x.kind,
    title: x.title,
    timerStatus: timerView(x, now).status,
    hasMedia: Boolean(x.mediaUrl),
    present: rows.filter((row) => row.roomId === x.id && !blocked.has(row.userId)).length,
  }));
}

export async function createRoom(user: User, spaceId: string, input: z.infer<typeof roomCreateSchema>) {
  const space = await connectSpace(user, spaceId, "write");
  const [total] = await db().select({ n: count() }).from(r).where(eq(r.spaceId, space.id));
  if (Number(total?.n ?? 0) >= MAX_ROOMS) throw new SocialError(422, `A Space can have up to ${MAX_ROOMS} rooms. Delete one first.`);
  const [row] = await db().insert(r).values({ spaceId: space.id, kind: input.kind, title: input.title, createdBy: user.id, updatedBy: user.id }).returning({ id: r.id });
  return { ok: true, id: row!.id };
}

export async function getRoom(user: User, spaceId: string, roomId: string) {
  const space = await connectSpace(user, spaceId, "read");
  return roomView(await loadRoom(space.id, roomId), user.id);
}

/** Any member who can post controls the shared timer (focus rooms) or the shared link (listen rooms). */
export async function changeRoom(user: User, spaceId: string, roomId: string, action: RoomAction) {
  const space = await connectSpace(user, spaceId, "write");
  const room = await loadRoom(space.id, roomId);
  let change;
  try {
    change = applyRoomAction(room, action, Date.now());
  } catch (err) {
    if (err instanceof RoomRuleError) throw new SocialError(err.status, err.message);
    throw err;
  }
  const [saved] = await db()
    .update(r)
    .set({ ...change, updatedBy: user.id })
    .where(and(eq(r.id, room.id), eq(r.spaceId, space.id)))
    .returning();
  return { ok: true, room: await roomView(saved ?? room, user.id) };
}

/** Whoever made the room, or the Space's owners and moderators. */
export async function deleteRoom(user: User, spaceId: string, roomId: string) {
  const space = await connectSpace(user, spaceId, "write");
  const room = await loadRoom(space.id, roomId);
  if (room.createdBy !== user.id && !space.canModerate) throw new SocialError(403, "Only whoever made the room, or the Space's owners and moderators, can delete it.");
  await db().delete(r).where(and(eq(r.id, room.id), eq(r.spaceId, space.id)));
}

/**
 * Heartbeat: "I'm in this room". Sent only after the person turned on "Show that I'm here", and the
 * body says so each time. Stores the time only: no location, no device details.
 */
export async function heartbeat(user: User, spaceId: string, roomId: string) {
  const space = await connectSpace(user, spaceId, "write");
  const room = await loadRoom(space.id, roomId);
  const now = new Date();
  await db()
    .insert(p)
    .values({ roomId: room.id, userId: user.id, lastSeenAt: now })
    .onConflictDoUpdate({ target: [p.roomId, p.userId], set: { lastSeenAt: now } });
  // Tidy: rows nobody refreshed for an hour are gone for good.
  await db()
    .delete(p)
    .where(and(eq(p.roomId, room.id), lt(p.lastSeenAt, new Date(now.getTime() - PRESENCE_TIDY_MS))));
  return { ok: true, room: await roomView(room, user.id) };
}

/** Leaves the room: this person's presence is deleted at once. */
export async function leaveRoom(user: User, spaceId: string, roomId: string) {
  const space = await connectSpace(user, spaceId, "read");
  const room = await loadRoom(space.id, roomId);
  await db()
    .delete(p)
    .where(and(eq(p.roomId, room.id), eq(p.userId, user.id)));
  return { ok: true };
}
