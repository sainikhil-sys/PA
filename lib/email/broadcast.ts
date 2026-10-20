import type { BroadcastEmailContent, MailBlock } from "@/lib/db/schema";
import { formatBytes } from "./attachments";
import { button, esc, eyebrow, FONT, h1, INK, layout, LINE, MUTED, p, updatesFooter, type Email } from "./templates";

/**
 * The designed broadcast email. Isomorphic on purpose: the composer's live preview and the
 * email that is actually sent come from this one renderer. Every piece of text is escaped;
 * the only markup authors get is **bold** and [label](url) links, and links must pass safeMailUrl.
 */

/** App pages an AI-written email may link to (the composer accepts any app path). */
export const IN_APP_PATHS = ["/", "/chat", "/inbox", "/tasks", "/automations", "/knowledge", "/content", "/phone", "/integrations", "/settings", "/settings/notifications", "/approvals", "/agents"] as const;

const APP_PATH = /^\/(?!\/)[\w\-./~%?=&#+:@]*$/;
const HIDDEN_PATH = /^\/console(?:[/?#]|$)/;
const MAILTO = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

/**
 * An absolute link that is safe to put in an email, or null. Accepts https/http and mailto
 * links, and app paths ("/settings" → `${appBase}/settings`). Rejects javascript:, data:,
 * protocol-relative links and links with embedded credentials.
 */
export function safeMailUrl(raw: string, appBase: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 2000) return null;
  if (s.startsWith("/")) return APP_PATH.test(s) && !HIDDEN_PATH.test(s) ? `${appBase}${s}` : null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol === "mailto:") return MAILTO.test(decodeURIComponent(u.pathname)) ? u.href : null;
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || !u.hostname.includes(".")) return null;
  return u.href;
}

const LINK = /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g;
const BOLD = /\*\*([^*\n]+?)\*\*/g;
const BARE_URL = /https?:\/\/[^\s<>()"'\]]+/g;

function boldHtml(s: string): string {
  return esc(s).replace(BOLD, '<strong style="font-weight:600">$1</strong>');
}

/** One line of author text as escaped HTML; links that fail safeMailUrl stay plain text. */
export function inlineHtml(text: string, appBase: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    out += boldHtml(text.slice(last, m.index));
    const url = safeMailUrl(m[2]!, appBase);
    out += url ? `<a href="${esc(url)}" style="color:${INK};text-decoration:underline">${boldHtml(m[1]!)}</a>` : boldHtml(m[1]!);
    last = m.index! + m[0].length;
  }
  return out + boldHtml(text.slice(last));
}

/** The same line for the plain-text part: "label (url)". */
export function inlineText(text: string, appBase: string): string {
  return text
    .replace(LINK, (_m, label: string, raw: string) => {
      const url = safeMailUrl(raw, appBase);
      return url ? `${label} (${url})` : label;
    })
    .replace(BOLD, "$1");
}

const CARD_WIDTH = 464; // the 520px card minus its 28px side padding

export type RenderOptions = {
  appBase: string;
  /** cid: when sending, a data: URL in the composer preview; null hides the image. */
  imageSrc: (fileId: string) => string | null;
  images?: ReadonlyMap<string, { width: number | null; height: number | null }>;
  attachments?: { filename: string; size: number }[];
  manageUrl: string;
  unsubscribeUrl: string;
};

const lines = (s: string) => s.replace(/\r\n?/g, "\n");

function blockHtml(b: MailBlock, o: RenderOptions): string {
  switch (b.type) {
    case "heading":
      return `<h2 style="margin:24px 0 8px;font:600 17px/24px ${FONT};color:${INK};letter-spacing:-0.2px">${esc(b.text)}</h2>`;
    case "text":
      return lines(b.text)
        .split(/\n{2,}/)
        .map((par) => par.trim())
        .filter(Boolean)
        .map((par) => p(par.split("\n").map((l) => inlineHtml(l, o.appBase)).join("<br>")))
        .join("\n");
    case "list": {
      const rows = b.items
        .map((i) => i.trim())
        .filter(Boolean)
        .map(
          (i) =>
            `<tr><td valign="top" style="width:20px;padding:0 0 8px;font:400 15px/24px ${FONT};color:${MUTED}">&#8226;</td><td style="padding:0 0 8px;font:400 15px/24px ${FONT};color:${INK}">${inlineHtml(i, o.appBase)}</td></tr>`,
        )
        .join("");
      return rows ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px">${rows}</table>` : "";
    }
    case "button": {
      const url = safeMailUrl(b.url, o.appBase);
      return url && b.label.trim() ? `${button(b.label.trim(), url)}<div style="height:20px;line-height:20px;font-size:0">&nbsp;</div>` : "";
    }
    case "image": {
      const src = o.imageSrc(b.fileId);
      if (!src) return "";
      const natural = o.images?.get(b.fileId)?.width ?? CARD_WIDTH;
      const width = Math.min(natural, CARD_WIDTH);
      const img = `<img src="${esc(src)}" alt="${esc(b.alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;border-radius:12px">`;
      const href = b.href ? safeMailUrl(b.href, o.appBase) : null;
      return `<div style="margin:4px 0 20px">${href ? `<a href="${esc(href)}" style="display:block">${img}</a>` : img}</div>`;
    }
    case "divider":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="border-top:1px solid ${LINE};height:1px;line-height:1px;font-size:0">&nbsp;</td></tr></table>`;
  }
}

function attachedHtml(files: { filename: string; size: number }[]): string {
  if (!files.length) return "";
  const rows = files
    .map((f) => `<tr><td style="padding:10px 0;border-top:1px solid ${LINE};font:400 14px/20px ${FONT};color:${INK}">${esc(f.filename)} <span style="color:${MUTED}">· ${esc(formatBytes(f.size))}</span></td></tr>`)
    .join("");
  return `${eyebrow("Attached").replace("margin:0 0 8px", "margin:20px 0 8px")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

function textPart(c: BroadcastEmailContent, o: RenderOptions): string {
  const out: string[] = [c.headline, ""];
  for (const b of c.blocks) {
    if (b.type === "heading") out.push(b.text, "");
    else if (b.type === "text") out.push(...lines(b.text).split("\n").map((l) => inlineText(l, o.appBase)), "");
    else if (b.type === "list") out.push(...b.items.filter((i) => i.trim()).map((i) => `• ${inlineText(i.trim(), o.appBase)}`), "");
    else if (b.type === "button") {
      const url = safeMailUrl(b.url, o.appBase);
      if (url) out.push(`${b.label}: ${url}`, "");
    } else if (b.type === "image" && b.alt.trim()) out.push(`[Image: ${b.alt.trim()}]`, "");
    else if (b.type === "divider") out.push("—", "");
  }
  if (o.attachments?.length) out.push(`Attached: ${o.attachments.map((f) => f.filename).join(", ")}`, "");
  out.push(`Notification settings: ${o.manageUrl}`, `Unsubscribe from updates: ${o.unsubscribeUrl}`);
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderBroadcastEmail(c: BroadcastEmailContent, o: RenderOptions): Email {
  const body = [h1(esc(c.headline)), ...c.blocks.map((b) => blockHtml(b, o)), attachedHtml(o.attachments ?? [])].filter(Boolean).join("\n");
  return {
    subject: c.subject,
    html: layout({ preheader: c.preheader || c.headline, body, footer: updatesFooter(o.manageUrl, o.unsubscribeUrl) }),
    text: textPart(c, o),
  };
}

/** What the AI drafter returns; turned into blocks the admin can edit. */
export type BroadcastDraft = {
  subject: string;
  preheader: string;
  headline: string;
  intro: string;
  sections: { heading?: string | null; text: string; bullets?: string[] | null }[];
  cta?: { label: string; url: string } | null;
  closing: string;
};

export function draftToEmail(d: BroadcastDraft): BroadcastEmailContent {
  const blocks: MailBlock[] = [];
  if (d.intro.trim()) blocks.push({ type: "text", text: d.intro.trim() });
  for (const s of d.sections) {
    if (s.heading?.trim()) blocks.push({ type: "heading", text: s.heading.trim() });
    if (s.text.trim()) blocks.push({ type: "text", text: s.text.trim() });
    const bullets = (s.bullets ?? []).map((x) => x.trim()).filter(Boolean);
    if (bullets.length) blocks.push({ type: "list", items: bullets });
  }
  if (d.cta?.label.trim() && d.cta.url.trim()) blocks.push({ type: "button", label: d.cta.label.trim(), url: d.cta.url.trim() });
  if (d.closing.trim()) blocks.push({ type: "text", text: d.closing.trim() });
  return { subject: d.subject.trim(), preheader: d.preheader.trim(), headline: d.headline.trim(), blocks };
}

/** URLs written in a note, without trailing punctuation. */
export function urlsIn(text: string): string[] {
  return Array.from(text.matchAll(BARE_URL), (m) => m[0].replace(/[.,;:!?]+$/, ""));
}

/**
 * The links an AI draft may use: URLs that appear in the admin's note, plus known app pages.
 * Anything else is something the model made up.
 */
export function linkAllowList(note: string): (url: string) => boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  const fromNote = new Set(urlsIn(note).map(norm));
  const pages = new Set<string>(IN_APP_PATHS);
  return (url) => {
    const u = url.trim();
    return u.startsWith("/") ? pages.has(u.replace(/\/+$/, "") || "/") : fromNote.has(norm(u));
  };
}

/** Drop buttons and unlink text whose URL isn't allowed; bare URLs that aren't allowed are removed (mail apps would linkify them). */
export function restrictLinks(blocks: MailBlock[], allowed: (url: string) => boolean): MailBlock[] {
  const fix = (t: string) =>
    t
      .replace(LINK, (m, label: string, url: string) => (allowed(url) ? m : label))
      .replace(BARE_URL, (u) => (allowed(u.replace(/[.,;:!?]+$/, "")) ? u : ""))
      .replace(/ {2,}/g, " ")
      .trim();
  return blocks.flatMap((b): MailBlock[] => {
    if (b.type === "button") return allowed(b.url) ? [b] : [];
    if (b.type === "text") return [{ ...b, text: fix(b.text) }];
    if (b.type === "list") return [{ ...b, items: b.items.map(fix).filter(Boolean) }];
    return [b];
  });
}

/** Plain text for the in-app and phone notification: no markdown, no links. */
export function plainNotificationText(text: string): string {
  return text
    .replace(LINK, "$1")
    .replace(BOLD, "$1")
    .replace(BARE_URL, "")
    .replace(/\s+/g, " ")
    .trim();
}
