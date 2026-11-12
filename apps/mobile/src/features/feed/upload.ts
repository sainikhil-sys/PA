import { api, ApiError } from "@/lib/api";

/**
 * Photos for posts. Each picked photo is re-encoded on the phone as a JPEG (at most 2048 px wide)
 * before upload: re-encoding drops EXIF, so location and camera details never leave the phone.
 * Uploads go straight to storage with a short-lived signed URL from /api/media.
 *
 * The picker and manipulator are native modules. They are loaded only when needed, so a build
 * without them still runs: the composer then says photos need an app update.
 */
export type LocalPhoto = { uri: string; width: number; height: number };

type Picker = typeof import("expo-image-picker");
type Manipulator = typeof import("expo-image-manipulator");

function load(): { picker: Picker; manipulator: Manipulator } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const picker = require("expo-image-picker") as Picker;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const manipulator = require("expo-image-manipulator") as Manipulator;
    return { picker, manipulator };
  } catch {
    return null;
  }
}

export const photosSupported = () => load() !== null;

const MAX_EDGE = 2048;

/** Re-encode: resized JPEG without metadata. */
async function clean(m: Manipulator, uri: string, width: number, height: number): Promise<LocalPhoto> {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const ctx = m.ImageManipulator.manipulate(uri);
  if (scale < 1) ctx.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: 0.85, format: m.SaveFormat.JPEG });
  return { uri: out.uri, width: out.width, height: out.height };
}

/** Opens the system photo picker (no storage permission needed on Android 13+). */
export async function pickPhotos(max: number): Promise<LocalPhoto[]> {
  const mods = load();
  if (!mods) throw new Error("Adding photos needs the latest version of Cowork.");
  const res = await mods.picker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: max, quality: 1, exif: false });
  if (res.canceled) return [];
  return Promise.all(res.assets.slice(0, max).map((a) => clean(mods.manipulator, a.uri, a.width, a.height)));
}

/** Uploads one cleaned photo and returns its media id for the post. */
export async function uploadPhoto(photo: LocalPhoto): Promise<string> {
  const blob = await (await fetch(photo.uri)).blob();
  const start = await api<{ id: string; upload: { method: "PUT"; url: string; headers: Record<string, string> } }>("/api/media", {
    body: { kind: "image", contentType: "image/jpeg", sizeBytes: blob.size },
  });
  let res: Response;
  try {
    res = await fetch(start.upload.url, { method: start.upload.method, headers: start.upload.headers, body: blob });
  } catch {
    throw new ApiError(0, "The photo didn't upload. Check your connection and try again.");
  }
  if (!res.ok) throw new ApiError(res.status, "The photo didn't upload. Try again.");
  await api(`/api/media/${start.id}/complete`, { body: { width: photo.width, height: photo.height } });
  return start.id;
}
