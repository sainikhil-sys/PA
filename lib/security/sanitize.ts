/**
 * Helpers for handling UNTRUSTED content (emails) before it reaches a model,
 * and for producing content-free log summaries.
 */

const MAX_EMAIL_CHARS = 6_000;

/** Very small HTML-to-text conversion; good enough for classification input. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove invisible/control characters often used to hide injected instructions. */
export function stripInvisible(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, "");
}

/**
 * Wrap untrusted email content in delimiter tags. Any attempt by the content to
 * close or open the tag itself is neutralised so it cannot escape the data block.
 */
export function wrapEmailContent(
  email: { from?: string | null; subject?: string | null; date?: string | null; body: string },
  maxChars = MAX_EMAIL_CHARS,
): string {
  const neutralise = (s: string) =>
    stripInvisible(s).replace(/<\/?\s*email_content[^>]*>/gi, "[tag removed]");
  const body = neutralise(email.body).slice(0, maxChars);
  const header = [
    `From: ${neutralise(email.from ?? "unknown")}`,
    `Subject: ${neutralise(email.subject ?? "")}`,
    email.date ? `Date: ${neutralise(email.date)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `<email_content>\n${header}\n\n${body}\n</email_content>`;
}

/** Truncate a string for display/log summaries. */
export function truncate(text: string, max = 80): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Remove anything that looks like a secret before logging an error message. */
export function redactSecrets(message: string): string {
  return message
    .replace(/pa_(mcp|oat|ort)_[A-Za-z0-9_-]+/g, "pa_$1_[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret|password)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted-google-token]")
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "sk-[redacted]");
}
