import "server-only";
import { htmlToText } from "@/lib/security/sanitize";

/** Vercel request bodies are capped (~4.5MB); stay under it. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const ACCEPTED_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
};

export function detectKind(name: string, type: string): "pdf" | "docx" | "txt" | "md" | null {
  const byType = ACCEPTED_TYPES[type];
  if (byType) return byType as "pdf" | "docx" | "txt" | "md";
  const ext = name.toLowerCase().split(".").pop();
  return ext === "pdf" || ext === "docx" || ext === "txt" || ext === "md" ? ext : null;
}

/** Extract plain text from an uploaded file. Never executes or renders the file. */
export async function extractText(buf: ArrayBuffer, kind: "pdf" | "docx" | "txt" | "md"): Promise<string> {
  if (kind === "pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n\n") : text;
  }
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
    return value;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

/** Fetch a public web page and reduce it to text (for "add by URL"). */
export async function fetchPageText(url: string): Promise<{ title: string; text: string }> {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http(s) URLs are supported");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) {
    throw new Error("Private addresses are not allowed");
  }
  const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "PA-knowledge/1.0", accept: "text/html,text/plain" } });
  if (!res.ok) throw new Error(`The page returned ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/(html|plain)/.test(type)) throw new Error("That URL isn't a web page");
  const raw = (await res.text()).slice(0, 2_000_000);
  const title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(raw)?.[1]?.trim() ?? u.hostname;
  const main = /<(article|main)[\s\S]*?<\/\1>/i.exec(raw)?.[0] ?? raw;
  return { title: htmlToText(title), text: type.includes("html") ? htmlToText(main) : raw };
}
