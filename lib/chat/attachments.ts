/**
 * Chat attachment rules shared by the composer (client) and the attach/chat
 * routes (server). Pure: no server-only imports, safe in unit tests.
 *
 * Attachment and pasted text is UNTRUSTED. It is only ever sent to the model
 * inside <source_content> (see lib/agent/attachment-context.ts).
 */

export const ATTACHMENT_KINDS = ["pdf", "docx", "txt", "md", "code", "paste"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export type ChatAttachmentInput = { name: string; text: string; kind: AttachmentKind };

/** Mirrors MAX_UPLOAD_BYTES in lib/knowledge/extract.ts (Vercel body cap). */
export const MAX_DOC_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 1024 * 1024;
/** Must equal the zod max in app/api/chat/route.ts. */
export const MAX_ATTACHMENT_CHARS = 60_000;
/** Must equal the zod max for `message` in app/api/chat/route.ts. */
export const MAX_MESSAGE_CHARS = 8_000;
export const PASTE_ATTACH_MIN_CHARS = 1_500;
export const PASTE_ATTACH_MIN_LINES = 25;
export const PASTE_CHIPS_MIN_CHARS = 80;

export const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "json", "jsonc", "sql", "go", "rs", "java", "kt", "kts", "swift",
  "c", "h", "cpp", "cc", "hpp", "cs", "rb", "php", "sh", "bash", "zsh", "ps1", "yml", "yaml", "toml", "ini", "cfg",
  "conf", "xml", "html", "htm", "css", "scss", "less", "vue", "svelte", "graphql", "gql", "proto", "r", "lua", "dart",
  "scala", "tf",
]); // prettier-ignore

export const TEXT_EXTENSIONS = new Map<string, "txt" | "md">([
  ["txt", "txt"],
  ["log", "txt"],
  ["csv", "txt"],
  ["tsv", "txt"],
  ["rst", "txt"],
  ["md", "md"],
  ["markdown", "md"],
  ["mdx", "md"],
]);

/** Lowercase basenames that are code without an extension. */
export const CODE_FILE_NAMES = new Set(["dockerfile", "makefile", ".gitignore", ".editorconfig"]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "svg", "tif", "tiff", "avif"]);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function baseName(name: string): string {
  return (name.split(/[\\/]/).pop() ?? "").trim();
}

function extOf(name: string): string {
  const b = baseName(name).toLowerCase();
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1) : "";
}

/** Keys, certificates and env files. Refused by name before anything is read. */
export function isSecretFile(name: string): boolean {
  return /^(\.env(\..*)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?|.*\.(pem|key|p12|pfx|jks|keystore))$/i.test(baseName(name));
}

export function isImageFile(name: string, type: string): boolean {
  return type.startsWith("image/") || IMAGE_EXTENSIONS.has(extOf(name));
}

/**
 * Extension first: browsers report `.ts` as video/mp2t and many code files with
 * an empty type, so the MIME type is only a fallback.
 */
export function detectChatKind(name: string, type: string): Exclude<AttachmentKind, "paste"> | null {
  if (isSecretFile(name) || isImageFile(name, type)) return null;
  const ext = extOf(name);
  if (CODE_EXTENSIONS.has(ext) || CODE_FILE_NAMES.has(baseName(name).toLowerCase())) return "code";
  const text = TEXT_EXTENSIONS.get(ext);
  if (text) return text;
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (type === DOCX_MIME || ext === "docx") return "docx";
  if (type === "text/markdown" || type === "text/x-markdown") return "md";
  if (type === "application/json") return "code";
  if (type.startsWith("text/")) return "txt";
  return null;
}

/** `accept` for the composer's file input. */
export const CHAT_ATTACH_ACCEPT = [
  ".pdf",
  ".docx",
  "application/pdf",
  "text/plain",
  "text/markdown",
  ...[...CODE_EXTENSIONS, ...TEXT_EXTENSIONS.keys()].map((e) => `.${e}`),
]
  .filter((v, i, a) => a.indexOf(v) === i)
  .join(",");

export const UNSUPPORTED_FILE = "Use a PDF, DOCX, text or code file.";
export const IMAGE_UNSUPPORTED = "Reading images isn't set up yet. Paste the text instead.";
export const SECRET_FILE_REFUSED = "That looks like a keys or .env file, so I won't read it.";

/** Rough check used to label a paste as code and to offer "Explain code". */
export function looksLikeCode(text: string): boolean {
  const lines = text.split("\n");
  let score = 0;
  if (lines.filter((l) => /(;|\{|\}|\))\s*$/.test(l)).length >= 3) score++;
  const kw = lines.filter((l) => /^\s*(import|export|const|let|var|function|def|class|return|if\s*\(|for\s*\(|#include|package|SELECT|CREATE|FROM|WHERE|INSERT|UPDATE)\b/.test(l)).length;
  // One code-like line is a hint; two or more is a strong one.
  if (kw >= 1) score++;
  if (kw >= 2) score++;
  const braces = (text.match(/[{}[\]]/g) ?? []).length;
  if (text.length > 0 && braces / text.length > 0.01) score++;
  const t = text.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) score++;
  return score >= 2;
}

/** Long pastes become an attachment chip instead of filling the message box. */
export function shouldAttachPaste(text: string): boolean {
  return text.length >= PASTE_ATTACH_MIN_CHARS || text.split("\n").length >= PASTE_ATTACH_MIN_LINES;
}

export function pastedName(text: string): string {
  return looksLikeCode(text) ? "Pasted code" : "Pasted text";
}

export const TRANSFORM_KINDS = ["summarize", "rewrite", "translate", "explain"] as const;
export type TransformKind = (typeof TRANSFORM_KINDS)[number];
export const TRANSFORM_LABEL: Record<TransformKind, string> = { summarize: "Summarize", rewrite: "Rewrite", translate: "Translate", explain: "Explain code" };

export const TRANSLATE_LANGUAGES = ["English", "Spanish", "French", "German", "Hindi", "Chinese (Simplified)", "Japanese"] as const;
export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number];

export function transformsFor(kind: AttachmentKind): TransformKind[] {
  return kind === "code" ? ["explain", "summarize"] : ["summarize", "rewrite", "translate"];
}

/** The user-visible message for a quick action. */
export function transformMessage(kind: TransformKind, language?: TranslateLanguage): string {
  if (kind === "summarize") return "Summarize this";
  if (kind === "rewrite") return "Rewrite this more clearly";
  if (kind === "translate") return `Translate this into ${language ?? "English"}`;
  return "Explain this code";
}
