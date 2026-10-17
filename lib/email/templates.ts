import { BRAND } from "@/lib/brand";

/**
 * Transactional email templates. Table layout + inline styles so they render in
 * Gmail, Outlook and Apple Mail. Monochrome, no images, no tracking pixels.
 * Everything dynamic is HTML-escaped: titles can come from untrusted email subjects.
 */
export type Email = { subject: string; html: string; text: string };

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const INK = "#0a0a0a";
const MUTED = "#6b6b70";
const LINE = "#e7e7ea";

/** Only same-site links ever go into an email button. */
export function appLink(base: string, href?: string | null): string {
  return href && href.startsWith("/") && !href.startsWith("//") ? `${base}${href}` : base;
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0"><tr><td style="background:${INK};border-radius:10px">
<a href="${esc(url)}" style="display:inline-block;padding:12px 20px;font:600 14px/20px ${FONT};color:#ffffff;text-decoration:none">${esc(label)}</a>
</td></tr></table>`;
}

function layout(o: { preheader: string; body: string; footer: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(BRAND.name)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f6;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(o.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f6"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="28" height="28" style="width:28px;height:28px;background:${INK};border-radius:8px;text-align:center;vertical-align:middle;font:700 14px/28px ${FONT};color:#ffffff">${esc(BRAND.name.charAt(0))}</td>
    <td style="padding-left:10px;font:600 16px/28px ${FONT};color:${INK};letter-spacing:-0.2px">${esc(BRAND.name)}</td>
  </tr></table>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:16px;padding:32px 28px;font:400 15px/24px ${FONT};color:${INK}">
${o.body}
</td></tr>
<tr><td style="padding:20px 4px 0;font:400 12px/18px ${FONT};color:${MUTED}">${o.footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function h1(s: string) {
  return `<h1 style="margin:0 0 12px;font:600 22px/30px ${FONT};color:${INK};letter-spacing:-0.3px">${s}</h1>`;
}
function p(s: string, muted = false) {
  return `<p style="margin:0 0 16px;font:400 15px/24px ${FONT};color:${muted ? MUTED : INK}">${s}</p>`;
}
function eyebrow(s: string) {
  return `<p style="margin:0 0 8px;font:600 11px/16px ${FONT};color:${MUTED};letter-spacing:0.8px;text-transform:uppercase">${esc(s)}</p>`;
}
function link(label: string, url: string) {
  return `<a href="${esc(url)}" style="color:${MUTED};text-decoration:underline">${esc(label)}</a>`;
}

export function otpEmail(code: string): Email {
  const body = [
    h1("Your sign-in code"),
    p("Enter this code to finish signing in. It expires in 10 minutes and works once."),
    `<div style="margin:8px 0 24px;padding:18px 0;border:1px solid ${LINE};border-radius:12px;text-align:center;font:600 34px/40px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:10px;color:${INK}">${esc(code)}</div>`,
    p("If you didn't try to sign in, you can ignore this email. Nobody can sign in without this code.", true),
  ].join("\n");
  return {
    subject: `${code} is your ${BRAND.name} sign-in code`,
    html: layout({ preheader: `${code} expires in 10 minutes`, body, footer: `Sent by ${esc(BRAND.name)} because a sign-in was requested for this address.` }),
    text: `Your ${BRAND.name} sign-in code is ${code}.\n\nIt expires in 10 minutes and works once. If you didn't try to sign in, ignore this email.\n\n— ${BRAND.name}`,
  };
}

const WELCOME_STEPS: [string, string][] = [
  ["Connect Google", "Your inbox and calendar feed the daily briefing. Read-only; replies are saved as drafts you send yourself."],
  ["Add knowledge", "Docs, notes and links you can search and chat with."],
  ["Connect Claude", "Use your tasks and notes from Claude with scoped, revocable access."],
];

export function welcomeEmail(o: { appUrl: string; manageUrl: string }): Email {
  const list = WELCOME_STEPS.map(
    ([t, d], i) =>
      `<tr><td valign="top" style="width:28px;padding:0 0 14px;font:600 13px/22px ${FONT};color:${MUTED}">${i + 1}</td><td style="padding:0 0 14px;font:400 14px/22px ${FONT};color:${INK}"><strong style="font-weight:600">${esc(t)}</strong><br><span style="color:${MUTED}">${esc(d)}</span></td></tr>`,
  ).join("");
  const body = [
    h1(`Welcome to ${esc(BRAND.name)}`),
    p("Your account is ready. Three steps to get the most out of it:"),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 12px">${list}</table>`,
    button(`Open ${BRAND.name}`, o.appUrl),
    `<p style="margin:24px 0 0;font:400 13px/20px ${FONT};color:${MUTED}">Nothing is ever sent, posted or deleted for you without your click.</p>`,
  ].join("\n");
  return {
    subject: `Welcome to ${BRAND.name}`,
    html: layout({
      preheader: "Your account is ready. Three steps to get going.",
      body,
      footer: `You're receiving this because you created a ${esc(BRAND.name)} account.<br>${link("Email preferences", o.manageUrl)}`,
    }),
    text: [`Welcome to ${BRAND.name}`, "", "Your account is ready.", ...WELCOME_STEPS.map(([t, d], i) => `${i + 1}. ${t}: ${d}`), "", `Open ${BRAND.name}: ${o.appUrl}`, "", `Email preferences: ${o.manageUrl}`].join("\n"),
  };
}

const KIND_LABEL: Record<string, string> = {
  urgent_email: "Urgent email",
  automation: "Automation",
  automation_failed: "Automation failed",
  reminder: "Reminder",
  post_reminder: "Scheduled post",
  announcement: "Announcement",
};

export function notificationEmail(o: { kind: string; title: string; body?: string | null; url: string; manageUrl: string; unsubscribeUrl: string }): Email {
  const label = KIND_LABEL[o.kind] ?? "Update";
  const body = [eyebrow(label), h1(esc(o.title)), o.body ? p(esc(o.body).replace(/\n/g, "<br>")) : "", button("View details", o.url)].join("\n");
  return {
    subject: o.title,
    html: layout({
      preheader: o.body?.slice(0, 120) || label,
      body,
      footer: `You're getting this because email updates are on in ${esc(BRAND.name)}.<br>${link("Notification settings", o.manageUrl)} · ${link("Unsubscribe from updates", o.unsubscribeUrl)}`,
    }),
    text: [`${label}: ${o.title}`, "", o.body ?? "", "", `View: ${o.url}`, "", `Unsubscribe: ${o.unsubscribeUrl}`].join("\n"),
  };
}

export type DigestContent = {
  headline: string;
  summary: string;
  priorities: string[];
  meetings: { start: string; title: string }[];
};

export function digestEmail(o: { date: string; b: DigestContent; appUrl: string; manageUrl: string; unsubscribeUrl: string }): Email {
  const section = (title: string, rows: string[]) =>
    rows.length
      ? `${eyebrow(title).replace("margin:0 0 8px", "margin:20px 0 8px")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.map((r) => `<tr><td style="padding:10px 0;border-top:1px solid ${LINE};font:400 14px/22px ${FONT};color:${INK}">${r}</td></tr>`).join("")}</table>`
      : "";
  const time = (m: { start: string }) => m.start.slice(11, 16) || "All day";
  const meetings = o.b.meetings.map((m) => `<span style="display:inline-block;min-width:60px;color:${MUTED}">${esc(time(m))}</span>${esc(m.title)}`);
  const body = [
    eyebrow(`Briefing · ${o.date}`),
    h1(esc(o.b.headline)),
    p(esc(o.b.summary)),
    section("Priorities", o.b.priorities.map(esc)),
    section("Meetings", meetings),
    `<div style="height:20px;line-height:20px">&nbsp;</div>`,
    button("Open today", o.appUrl),
  ].join("\n");
  return {
    subject: `Your briefing for ${o.date}`,
    html: layout({
      preheader: o.b.headline,
      body,
      footer: `Your daily briefing from ${esc(BRAND.name)}.<br>${link("Notification settings", o.manageUrl)} · ${link("Stop daily briefings", o.unsubscribeUrl)}`,
    }),
    text: [
      o.b.headline,
      "",
      o.b.summary,
      "",
      ...(o.b.priorities.length ? ["Priorities:", ...o.b.priorities.map((x) => `• ${x}`), ""] : []),
      ...(o.b.meetings.length ? ["Meetings:", ...o.b.meetings.map((m) => `• ${time(m)} ${m.title}`), ""] : []),
      `Open ${BRAND.name}: ${o.appUrl}`,
      `Stop daily briefings: ${o.unsubscribeUrl}`,
    ].join("\n"),
  };
}
