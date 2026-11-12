import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SocialError } from "@/lib/social/service";
import { headObject, type R2Config, r2Config, uploadUrl } from "./r2";

/**
 * Uploads (B3): the device asks for a slot, PUTs the bytes straight to R2 with the signed link,
 * then confirms. Confirming checks the stored object really is the declared size and type.
 * The app re-encodes photos before upload, which drops location and other metadata. Image
 * moderation (media.moderation) is not wired yet: it needs a vision-capable model; until then
 * every new file stays "pending" and only a "flagged" file is refused (see posts.ts).
 */

export const LIMITS = {
  image: { types: ["image/jpeg", "image/png", "image/webp", "image/heic"], maxBytes: 15 * 1024 * 1024 },
  video: { types: ["video/mp4", "video/quicktime"], maxBytes: 200 * 1024 * 1024 },
  audio: { types: ["audio/mp4", "audio/aac", "audio/mpeg", "audio/ogg", "audio/webm"], maxBytes: 25 * 1024 * 1024 },
} as const;
export type MediaKind = keyof typeof LIMITS;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};

function config(): R2Config {
  const cfg = r2Config();
  if (!cfg) throw new SocialError(503, "Photo and video uploads aren't available yet.");
  return cfg;
}

export function checkUpload(kind: MediaKind, contentType: string, sizeBytes: number): string | null {
  const rule = LIMITS[kind];
  if (!(rule.types as readonly string[]).includes(contentType)) return "That file type isn't supported.";
  if (sizeBytes <= 0) return "That file is empty.";
  if (sizeBytes > rule.maxBytes) return `That file is too large. The limit is ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`;
  return null;
}

export async function startUpload(userId: string, input: { kind: MediaKind; contentType: string; sizeBytes: number }) {
  const cfg = config();
  const problem = checkUpload(input.kind, input.contentType, input.sizeBytes);
  if (problem) throw new SocialError(400, problem);
  // Keys never contain anything the person typed: user id, random id, extension.
  const key = `u/${userId}/${randomUUID()}.${EXT[input.contentType]}`;
  const [row] = await db()
    .insert(schema.media)
    .values({ userId, kind: input.kind, contentType: input.contentType, sizeBytes: input.sizeBytes, key })
    .returning({ id: schema.media.id });
  return { id: row!.id, upload: { method: "PUT" as const, ...uploadUrl(cfg, key, input.contentType) } };
}

/** After the PUT: the object must exist with the declared type and size (within 1 KB). */
export async function completeUpload(userId: string, mediaId: string, dims: { width?: number; height?: number; durationMs?: number }) {
  const cfg = config();
  const [m] = await db()
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, mediaId), eq(schema.media.userId, userId)))
    .limit(1);
  if (!m) throw new SocialError(404, "That upload isn't available.");
  if (m.status === "ready") return { id: m.id, status: m.status, moderation: m.moderation };
  if (m.status !== "uploading") throw new SocialError(410, "That upload was removed.");
  const head = await headObject(cfg, m.key);
  if (!head) throw new SocialError(409, "The file hasn't finished uploading. Try again.");
  if (head.contentType !== m.contentType || Math.abs(head.size - m.sizeBytes) > 1024) throw new SocialError(400, "The uploaded file doesn't match what was expected. Upload it again.");
  await db()
    .update(schema.media)
    .set({ status: "ready", readyAt: new Date(), sizeBytes: head.size, width: dims.width ?? null, height: dims.height ?? null, durationMs: dims.durationMs ?? null })
    .where(eq(schema.media.id, m.id));
  return { id: m.id, status: "ready" as const, moderation: m.moderation };
}
