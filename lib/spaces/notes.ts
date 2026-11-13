import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import type { SpaceNote, User } from "@/lib/db/schema";
import { SocialError } from "@/lib/social/service";
import { connectSpace, displayNames, FALLBACK_NAME } from "@/lib/spaces/connect";

/**
 * A Space's shared notes. Members read them; members who can post write them; whoever created a
 * note, or the Space's owners and moderators, delete it. Saves send the version they started from
 * and only apply if nobody saved in between; otherwise the caller gets the latest to merge.
 */

export const NOTE_TITLE_MAX = 120;
export const NOTE_BODY_MAX = 20_000;
export const MAX_NOTES = 200;

export const noteFields = {
  title: z.string().trim().min(1, "Give the note a title.").max(NOTE_TITLE_MAX, `Keep the title under ${NOTE_TITLE_MAX} characters.`),
  body: z.string().max(NOTE_BODY_MAX, "Notes can be up to 20,000 characters."),
};
export const noteSchema = z.object(noteFields);
export const noteUpdateSchema = z.object({ ...noteFields, version: z.number().int().min(1) });

export const CONFLICT_MESSAGE = "Someone else saved this note while you were editing. Your text is kept below the latest version.";

const n = schema.spaceNotes;

export type NoteView = { id: string; title: string; body: string; version: number; updatedBy: string | null; updatedAt: string; mine: boolean };

async function view(note: SpaceNote, viewerId: string): Promise<NoteView> {
  const names = await displayNames(note.updatedBy ? [note.updatedBy] : []);
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    version: note.version,
    updatedBy: note.updatedBy ? (names.get(note.updatedBy) ?? FALLBACK_NAME) : null,
    updatedAt: note.updatedAt.toISOString(),
    mine: note.createdBy === viewerId,
  };
}

async function loadNote(spaceId: string, noteId: string) {
  const [note] = await db()
    .select()
    .from(n)
    .where(and(eq(n.id, noteId), eq(n.spaceId, spaceId)))
    .limit(1);
  if (!note) throw new SocialError(404, "That note no longer exists.");
  return note;
}

/** Titles only, most recently edited first; open one to read it. */
export async function listNotes(user: User, spaceId: string) {
  const space = await connectSpace(user, spaceId, "read");
  const rows = await db()
    .select({ id: n.id, title: n.title, version: n.version, updatedBy: n.updatedBy, updatedAt: n.updatedAt })
    .from(n)
    .where(eq(n.spaceId, space.id))
    .orderBy(desc(n.updatedAt))
    .limit(MAX_NOTES);
  const names = await displayNames(rows.flatMap((r) => (r.updatedBy ? [r.updatedBy] : [])));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    version: r.version,
    updatedBy: r.updatedBy ? (names.get(r.updatedBy) ?? FALLBACK_NAME) : null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function createNote(user: User, spaceId: string, input: z.infer<typeof noteSchema>) {
  const space = await connectSpace(user, spaceId, "write");
  const [total] = await db().select({ n: count() }).from(n).where(eq(n.spaceId, space.id));
  if (Number(total?.n ?? 0) >= MAX_NOTES) throw new SocialError(422, `A Space can have up to ${MAX_NOTES} notes. Delete one first.`);
  const [row] = await db()
    .insert(n)
    .values({ spaceId: space.id, title: input.title, body: input.body, createdBy: user.id, updatedBy: user.id })
    .returning({ id: n.id, version: n.version });
  return { ok: true, id: row!.id, version: row!.version };
}

export async function getNote(user: User, spaceId: string, noteId: string) {
  const space = await connectSpace(user, spaceId, "read");
  return view(await loadNote(space.id, noteId), user.id);
}

/** Saved: `{ note }`. Someone saved first: `{ conflict }` with the latest note. */
export async function updateNote(user: User, spaceId: string, noteId: string, input: z.infer<typeof noteUpdateSchema>): Promise<{ note: NoteView } | { conflict: NoteView }> {
  const space = await connectSpace(user, spaceId, "write");
  const note = await loadNote(space.id, noteId);
  const [saved] = await db()
    .update(n)
    .set({ title: input.title, body: input.body, version: sql`${n.version} + 1`, updatedBy: user.id })
    .where(and(eq(n.id, note.id), eq(n.spaceId, space.id), eq(n.version, input.version)))
    .returning();
  if (saved) return { note: await view(saved, user.id) };
  return { conflict: await view(await loadNote(space.id, note.id), user.id) };
}

/** Whoever created the note, or the Space's owners and moderators. */
export async function deleteNote(user: User, spaceId: string, noteId: string) {
  const space = await connectSpace(user, spaceId, "write");
  const note = await loadNote(space.id, noteId);
  if (note.createdBy !== user.id && !space.canModerate) throw new SocialError(403, "Only whoever created the note, or the Space's owners and moderators, can delete it.");
  await db().delete(n).where(and(eq(n.id, note.id), eq(n.spaceId, space.id)));
}
