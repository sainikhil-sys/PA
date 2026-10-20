import "server-only";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { UserFacingError } from "@/lib/auth/action";
import { db, schema } from "@/lib/db";
import type { BroadcastEmailContent, BroadcastFile } from "@/lib/db/schema";
import { cidFor, formatBytes, MAX_ATTACHMENTS, MAX_INLINE_IMAGES, MAX_TOTAL_BYTES, type UploadRole } from "@/lib/email/attachments";
import type { MailAttachment } from "@/lib/email/send";

/**
 * Images and documents for broadcast emails. Uploaded one at a time while composing
 * (broadcast_id null), linked to the broadcast when it's sent. The bytes are only read
 * when an email goes out.
 */
const f = schema.broadcastFiles;
const META = { id: f.id, role: f.role, filename: f.filename, contentType: f.contentType, size: f.size, width: f.width, height: f.height } as const;
export type BroadcastFileMeta = Pick<BroadcastFile, keyof typeof META>;

const UNSENT_TTL_MS = 24 * 3600_000;

export async function saveBroadcastFile(o: Omit<BroadcastFileMeta, "id"> & { uploadedBy: string; data: Buffer; role: UploadRole }): Promise<BroadcastFileMeta> {
  const [row] = await db().insert(f).values(o).returning(META);
  return row!;
}

/** Uploads nobody sent within a day are dropped (called on each upload). */
export async function pruneUnsentFiles() {
  await db()
    .delete(f)
    .where(and(isNull(f.broadcastId), lt(f.createdAt, new Date(Date.now() - UNSENT_TTL_MS))));
}

export async function deleteUnsentFile(userId: string, id: string) {
  await db()
    .delete(f)
    .where(and(eq(f.id, id), eq(f.uploadedBy, userId), isNull(f.broadcastId)));
}

/** Image files the email's blocks show. */
export function referencedImages(email: BroadcastEmailContent | null): string[] {
  return email ? [...new Set(email.blocks.flatMap((b) => (b.type === "image" ? [b.fileId] : [])))] : [];
}

/**
 * The files an email will carry: every image block and every attachment must be one of the
 * sender's own unsent uploads with the right role, and together they must fit the limits.
 */
export async function resolveBroadcastFiles(userId: string, email: BroadcastEmailContent | null, attachmentIds: string[]): Promise<BroadcastFileMeta[]> {
  const images = referencedImages(email);
  const attachments = [...new Set(attachmentIds)];
  const ids = [...new Set([...images, ...attachments])];
  if (!ids.length) return [];
  if (images.length > MAX_INLINE_IMAGES) throw new UserFacingError(`An email can show up to ${MAX_INLINE_IMAGES} images.`);
  if (attachments.length > MAX_ATTACHMENTS) throw new UserFacingError(`An email can carry up to ${MAX_ATTACHMENTS} attachments.`);
  const rows = await db()
    .select(META)
    .from(f)
    .where(and(inArray(f.id, ids), eq(f.uploadedBy, userId), isNull(f.broadcastId)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (images.some((id) => byId.get(id)?.role !== "inline")) throw new UserFacingError("An image in the email is missing. Upload it again.");
  if (attachments.some((id) => byId.get(id)?.role !== "attachment")) throw new UserFacingError("An attachment is missing. Attach it again.");
  const total = rows.reduce((n, r) => n + r.size, 0);
  if (total > MAX_TOTAL_BYTES) throw new UserFacingError(`Images and attachments add up to ${formatBytes(total)}. The limit is ${formatBytes(MAX_TOTAL_BYTES)}.`);
  return rows;
}

export async function linkFilesToBroadcast(userId: string, ids: string[], broadcastId: string) {
  if (!ids.length) return;
  await db()
    .update(f)
    .set({ broadcastId })
    .where(and(inArray(f.id, ids), eq(f.uploadedBy, userId), isNull(f.broadcastId)));
}

/** Files of a sent broadcast, with their bytes. */
export async function filesForBroadcast(broadcastId: string): Promise<BroadcastFile[]> {
  return db().select().from(f).where(eq(f.broadcastId, broadcastId));
}

/** Unsent uploads with their bytes (for "Send test to me"). */
export async function unsentFilesWithData(userId: string, ids: string[]): Promise<BroadcastFile[]> {
  if (!ids.length) return [];
  return db()
    .select()
    .from(f)
    .where(and(inArray(f.id, ids), eq(f.uploadedBy, userId), isNull(f.broadcastId)));
}

/** How a set of files goes into an email: attachments for Resend, plus what the renderer needs. */
export function mailParts(files: BroadcastFile[]) {
  const inline = files.filter((x) => x.role === "inline");
  const attached = files.filter((x) => x.role === "attachment");
  const attachments: MailAttachment[] = files.map((x) => ({
    filename: x.filename,
    content: x.data,
    contentType: x.contentType,
    ...(x.role === "inline" ? { contentId: cidFor(x.id) } : {}),
  }));
  const images = new Map(inline.map((x) => [x.id, { width: x.width, height: x.height }]));
  return {
    attachments,
    images,
    imageSrc: (id: string) => (images.has(id) ? `cid:${cidFor(id)}` : null),
    attachedList: attached.map((x) => ({ filename: x.filename, size: x.size })),
  };
}

/** Count of files per broadcast, for the history table. */
export async function fileCounts(broadcastIds: string[]): Promise<Map<string, number>> {
  if (!broadcastIds.length) return new Map();
  const rows = await db().select({ id: f.broadcastId }).from(f).where(inArray(f.broadcastId, broadcastIds));
  const out = new Map<string, number>();
  for (const r of rows) if (r.id) out.set(r.id, (out.get(r.id) ?? 0) + 1);
  return out;
}
