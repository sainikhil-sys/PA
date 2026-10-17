import type { gmail_v1 } from "googleapis";
import { htmlToText } from "@/lib/security/sanitize";

/** Pure helpers (no network) so they can be unit tested. */

export function parseFrom(value: string | undefined | null): { name: string | null; email: string | null } {
  if (!value) return { name: null, email: null };
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (m) return { name: m[1]?.trim() || null, email: m[2]?.trim().toLowerCase() ?? null };
  return { name: null, email: value.trim().toLowerCase() };
}

function decodePart(data: string | null | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

/** Extract a plain-text body (prefers text/plain, falls back to stripped HTML). */
export function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const parts: gmail_v1.Schema$MessagePart[] = [];
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    parts.push(p);
    p.parts?.forEach(walk);
  };
  walk(payload);
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain) return decodePart(plain.body?.data);
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data);
  if (html) return htmlToText(decodePart(html.body?.data));
  return decodePart(payload.body?.data);
}

/** RFC 2822 reply message. Header values are stripped of CR/LF to prevent header injection. */
/** A brand-new plain-text email (no "Re:", no thread headers). */
export function buildComposeMime(opts: { to: string; subject: string; body: string }): string {
  const clean = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
  const lines = [`To: ${clean(opts.to)}`, `Subject: ${clean(opts.subject)}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit"];
  return `${lines.join("\r\n")}\r\n\r\n${opts.body}`;
}

export function buildReplyMime(opts: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
  const clean = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
  const subject = clean(opts.subject);
  const lines = [
    `To: ${clean(opts.to)}`,
    `Subject: ${/^re:/i.test(subject) ? subject : `Re: ${subject}`}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  if (opts.inReplyTo) {
    lines.push(`In-Reply-To: ${clean(opts.inReplyTo)}`);
    lines.push(`References: ${clean([opts.references, opts.inReplyTo].filter(Boolean).join(" "))}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n${opts.body}`;
}
