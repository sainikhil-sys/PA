import { fromBase64 } from "./bytes";

/**
 * Pure rules for Connect file transfers: limits, blocked types, and validation of what a peer sends.
 * No React Native imports, so it runs in unit tests. Peers are untrusted: every field is checked.
 */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** An offer not answered within this time expires on both phones. */
export const OFFER_TTL_MS = 10 * 60_000;
/** Thumbnails ride inside the encrypted offer message, which has a 30 KB budget. */
export const MAX_THUMB_B64 = 16_000;
/** Pending offers one person can have waiting for approval at once. */
export const MAX_PENDING_FROM_PEER = 10;
export const MAX_NAME = 120;
export const MAX_VOICE_MS = 5 * 60_000;

export type TransferKind = "file" | "snap" | "voice";

export type Offer = {
  transferId: string;
  name: string;
  size: number;
  mime: string;
  sha256: string;
  fileKey: string;
  thumb: string | null;
  expiresAt: number;
  kind: TransferKind;
  disappearing: boolean;
  durationMs: number | null;
};

/** Programs and installers: never sent or accepted, whatever the other phone claims. */
const BLOCKED_EXT = new Set([
  "apk", "apks", "aab", "xapk", "apkm", "dex", "so", "jar", "exe", "msi", "msix", "msp", "appx", "bat", "cmd", "com", "scr", "pif", "cpl", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "lnk", "reg", "dll", "sys", "sh", "bash", "run", "bin", "elf", "app", "dmg", "pkg", "deb", "rpm", "appimage", "ipa", "command", "scpt", "gadget", "inf", "action", "workflow",
]);
const BLOCKED_MIME = [
  "application/vnd.android.package-archive",
  "application/x-msdownload",
  "application/x-ms-installer",
  "application/x-msi",
  "application/x-dosexec",
  "application/x-executable",
  "application/x-elf",
  "application/x-sharedlib",
  "application/x-sh",
  "application/x-shellscript",
  "application/java-archive",
  "application/x-java-archive",
  "application/x-apple-diskimage",
  "application/x-bat",
  "application/javascript",
  "text/javascript",
  "application/x-ms-shortcut",
  "application/hta",
];

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** True for executable or installer files, judged by every extension in the name and by type. */
export function isBlockedFile(name: string, mime: string): boolean {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase().replace(/[\s.]+$/, "");
  // The last extension decides how a phone or computer opens a file. Trailing dots and spaces are
  // stripped first, so "photo.jpg.apk" and "setup.exe. " are both caught.
  const dot = base.lastIndexOf(".");
  if (dot > 0 && BLOCKED_EXT.has(base.slice(dot + 1).trim())) return true;
  const m = mime.toLowerCase().split(";")[0]!.trim();
  return BLOCKED_MIME.includes(m);
}

/** A file name that is safe to show and to write: no folders, control characters or leading dots. */
export function safeName(name: string, fallback = "file"): string {
  let clean = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/^[.\s]+/, "")
    .trim();
  if (clean.length > MAX_NAME) {
    const ext = extensionOf(clean);
    const keep = ext && ext.length < 12 ? `.${ext}` : "";
    clean = clean.slice(0, MAX_NAME - keep.length) + keep;
  }
  return clean || fallback;
}

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,99}$/;
export function cleanMime(mime: unknown): string {
  if (typeof mime !== "string") return "application/octet-stream";
  const m = mime.toLowerCase().split(";")[0]!.trim();
  return MIME_RE.test(m) ? m : "application/octet-stream";
}

export type MediaClass = "image" | "video" | "audio" | "document";
export function mediaClass(mime: string): MediaClass {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

/** Guesses a type from the extension when a picker gives none. */
export function mimeFromName(name: string): string {
  const ext = extensionOf(name);
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp", mkv: "video/x-matroska",
    m4a: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", opus: "audio/opus",
    pdf: "application/pdf", txt: "text/plain", csv: "text/csv", zip: "application/zip",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] ?? "application/octet-stream";
}

export type CheckResult = { ok: true } | { ok: false; reason: string };

/** What the sender checks before offering a file. */
export function checkOutgoing(name: string, size: number, mime: string): CheckResult {
  if (isBlockedFile(name, mime)) return { ok: false, reason: "Apps, installers and scripts cannot be sent over Connect." };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, reason: "This file is empty or could not be read." };
  if (size > MAX_FILE_BYTES) return { ok: false, reason: `This file is ${formatBytes(size)}. The limit is ${formatBytes(MAX_FILE_BYTES)} per file.` };
  return { ok: true };
}

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export const isTransferId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);

function validKey(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 64) return false;
  try {
    return fromBase64(v).length === 32;
  } catch {
    return false;
  }
}

function validThumb(v: unknown): string | null {
  if (typeof v !== "string" || !v || v.length > MAX_THUMB_B64 || !/^[A-Za-z0-9+/]+=*$/.test(v)) return null;
  try {
    const b = fromBase64(v.slice(0, 8));
    // JPEG files start with FF D8 FF.
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? v : null;
  } catch {
    return null;
  }
}

/**
 * Validates an incoming file.offer. Returns null for anything malformed, too large, expired,
 * executable, or with a bad key. Never trusts the sender's name for paths.
 */
export function parseOffer(m: Record<string, unknown>, now = Date.now()): Offer | null {
  if (!isTransferId(m.transferId)) return null;
  if (typeof m.name !== "string" || !m.name.trim()) return null;
  const name = safeName(m.name.slice(0, 400));
  const size = m.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) return null;
  const mime = cleanMime(m.mime);
  if (isBlockedFile(name, mime)) return null;
  if (typeof m.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(m.sha256)) return null;
  if (!validKey(m.fileKey)) return null;
  const expiresAt = m.expiresAt;
  // Expired, or claiming more than the allowed lifetime (plus clock skew between phones).
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + OFFER_TTL_MS + 5 * 60_000) return null;
  const kind: TransferKind = m.kind === "snap" || m.kind === "voice" ? m.kind : "file";
  if (kind === "voice" && mediaClass(mime) !== "audio") return null;
  if (kind === "snap" && !["image", "video"].includes(mediaClass(mime))) return null;
  const durationMs = kind === "voice" && typeof m.durationMs === "number" && Number.isFinite(m.durationMs) ? Math.max(0, Math.min(MAX_VOICE_MS, Math.round(m.durationMs))) : null;
  const disappearing = kind === "snap" && m.disappearing === true;
  return {
    transferId: m.transferId,
    name,
    size,
    mime,
    sha256: m.sha256,
    fileKey: m.fileKey as string,
    // A view-once snap never carries a preview: the thumbnail would be a copy that does not disappear.
    thumb: disappearing ? null : validThumb(m.thumb),
    expiresAt,
    kind,
    disappearing,
    durationMs,
  };
}

/** Checks that what was decrypted is exactly what was offered. */
export function matchesOffer(got: { size: number; sha256: string }, offer: { size: number; sha256: string }): boolean {
  return got.size === offer.size && got.sha256.toLowerCase() === offer.sha256.toLowerCase();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function typeLabel(mime: string, kind: TransferKind): string {
  if (kind === "voice") return "Voice message";
  const c = mediaClass(mime);
  if (c === "image") return "Photo";
  if (c === "video") return "Video";
  if (c === "audio") return "Audio";
  if (mime === "application/pdf") return "PDF";
  return "Document";
}

export function percent(done: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((done / total) * 100)));
}
