/**
 * What a broadcast email may carry: images shown in the body (sent inline, referenced as cid:)
 * and documents sent as attachments. Pure and isomorphic: the server enforces it on upload,
 * the composer uses the same limits for early feedback.
 *
 * A file is accepted only if its extension is on the allowlist AND its bytes match that type.
 * The content type always comes from this table, never from the browser. No SVG (can carry
 * script), no legacy or macro-enabled Office files, no archives or executables.
 */

export type UploadRole = "inline" | "attachment";
export type FileKind = "image" | "doc";

export const MAX_INLINE_BYTES = 2 * 1024 * 1024;
/** Uploads go one per request and Vercel caps request bodies at 4.5 MB. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
/** Everything one email carries (images + attachments); Resend allows 40 MB after base64. */
export const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
export const MAX_INLINE_IMAGES = 6;
export const MAX_ATTACHMENTS = 8;

export const ACCEPT_IMAGES = ".png,.jpg,.jpeg,.gif,.webp";
export const ACCEPT_ATTACHMENTS = `.pdf,.docx,.xlsx,.pptx,.csv,.txt,.md,.ics,${ACCEPT_IMAGES}`;

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
/** Byte-for-byte string view (only used to look for ASCII markers). */
const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return s;
};

const isPng = (b: Uint8Array) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isJpeg = (b: Uint8Array) => startsWith(b, [0xff, 0xd8, 0xff]);
const isGif = (b: Uint8Array) => startsWith(b, ascii("GIF87a")) || startsWith(b, ascii("GIF89a"));
const isWebp = (b: Uint8Array) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8);
const isPdf = (b: Uint8Array) => startsWith(b, ascii("%PDF-"));
/** Text files: no NUL bytes in the first 8 KB. */
const isText = (b: Uint8Array) => b.length > 0 && !b.subarray(0, 8192).includes(0);
/** Office Open XML is a zip whose part names include the app folder (word/, xl/, ppt/). */
const isOoxml = (folder: string) => (b: Uint8Array) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) && latin1(b).includes(folder);

type Rule = { ext: string[]; type: string; kind: FileKind; matches: (b: Uint8Array) => boolean };

const RULES: Rule[] = [
  { ext: ["png"], type: "image/png", kind: "image", matches: isPng },
  { ext: ["jpg", "jpeg"], type: "image/jpeg", kind: "image", matches: isJpeg },
  { ext: ["gif"], type: "image/gif", kind: "image", matches: isGif },
  { ext: ["webp"], type: "image/webp", kind: "image", matches: isWebp },
  { ext: ["pdf"], type: "application/pdf", kind: "doc", matches: isPdf },
  { ext: ["docx"], type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "doc", matches: isOoxml("word/") },
  { ext: ["xlsx"], type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "doc", matches: isOoxml("xl/") },
  { ext: ["pptx"], type: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "doc", matches: isOoxml("ppt/") },
  { ext: ["csv"], type: "text/csv", kind: "doc", matches: isText },
  { ext: ["txt"], type: "text/plain", kind: "doc", matches: isText },
  { ext: ["md"], type: "text/markdown", kind: "doc", matches: isText },
  { ext: ["ics"], type: "text/calendar", kind: "doc", matches: (b) => isText(b) && latin1(b.subarray(0, 256)).toUpperCase().includes("BEGIN:VCALENDAR") },
];

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A safe display/attachment name: no path, no control or bidi-override characters (which can
 * disguise "invoice‮fdp.exe"), no characters Windows rejects, a lowercase extension.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩<>:"|?*]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 ? cleaned.slice(dot + 1).toLowerCase() : "";
  const stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned).slice(0, 100).trim() || "file";
  return ext ? `${stem}.${ext}` : stem;
}

/** Pixel size of a PNG, JPEG, GIF or WebP from its header; null if it can't be read. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u16le = (i: number) => b[i]! | (b[i + 1]! << 8);
  const u24le = (i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
  const u32be = (i: number) => ((b[i]! << 24) >>> 0) + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!);
  const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);

  if (isPng(b) && b.length >= 24) return ok(u32be(16), u32be(20));
  if (isGif(b) && b.length >= 10) return ok(u16le(6), u16le(8));
  if (isWebp(b) && b.length >= 30) {
    const chunk = latin1(b.subarray(12, 16));
    if (chunk === "VP8 ") return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff);
    if (chunk === "VP8L") return ok(1 + (((b[22]! & 0x3f) << 8) | b[21]!), 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)));
    if (chunk === "VP8X") return ok(1 + u24le(24), 1 + u24le(27));
    return null;
  }
  if (isJpeg(b)) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      // Markers without a length: TEM, RSTn, SOI.
      if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16be(i + 2);
      if (len < 2) return null;
      // SOFn frames hold the size (C4 = DHT, C8 = JPG, CC = DAC are not frames).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ok(u16be(i + 7), u16be(i + 5));
      i += 2 + len;
    }
  }
  return null;
}

export type Classified =
  | { ok: true; filename: string; contentType: string; kind: FileKind; width: number | null; height: number | null }
  | { ok: false; error: string };

/** Decide whether an uploaded file may go into a broadcast email, and how. */
export function classifyUpload(name: string, bytes: Uint8Array, role: UploadRole): Classified {
  const filename = sanitizeFilename(name);
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1) : "";
  const rule = RULES.find((r) => r.ext.includes(ext));
  if (!rule) return { ok: false, error: "That file type isn't allowed. Use PDF, Word, Excel, PowerPoint, CSV, text, calendar files or PNG, JPEG, GIF and WebP images." };
  if (role === "inline" && rule.kind !== "image") return { ok: false, error: "Images in the email must be PNG, JPEG, GIF or WebP." };
  const max = role === "inline" ? MAX_INLINE_BYTES : MAX_ATTACHMENT_BYTES;
  if (bytes.length === 0) return { ok: false, error: "That file is empty." };
  if (bytes.length > max) return { ok: false, error: `That file is over ${formatBytes(max)}.` };
  if (!rule.matches(bytes)) return { ok: false, error: "That file's contents don't match its type." };
  if (rule.type.includes("openxmlformats") && latin1(bytes).includes("vbaProject.bin")) return { ok: false, error: "Files with macros can't be attached." };
  const size = rule.kind === "image" ? imageSize(bytes) : null;
  if (rule.kind === "image" && !size) return { ok: false, error: "That image couldn't be read." };
  return { ok: true, filename, contentType: rule.type, kind: rule.kind, width: size?.width ?? null, height: size?.height ?? null };
}

/** The Content-ID an inline image is sent under; the HTML refers to it as cid:<id>. */
export function cidFor(fileId: string): string {
  return `img-${fileId}`;
}
