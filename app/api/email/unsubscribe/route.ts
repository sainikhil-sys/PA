import { eq } from "drizzle-orm";
import { BRAND } from "@/lib/brand";
import { db, schema } from "@/lib/db";
import { esc } from "@/lib/email/templates";
import { verifyUnsubscribeToken, type EmailTopic } from "@/lib/email/unsubscribe";
import { appUrl, requireEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const LABEL: Record<EmailTopic, string> = { updates: "email updates", digest: "daily briefing emails" };

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ${esc(BRAND.name)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f6;font:15px/24px -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0a0a0a;padding:16px}
main{max-width:420px;width:100%;background:#fff;border:1px solid #e7e7ea;border-radius:16px;padding:32px 28px}h1{font-size:22px;line-height:30px;margin:0 0 8px;font-weight:600}p{margin:0 0 20px;color:#6b6b70}
button,a.b{display:inline-block;background:#0a0a0a;color:#fff;border:0;border-radius:10px;padding:12px 20px;font:600 14px/20px inherit;cursor:pointer;text-decoration:none}a{color:#0a0a0a}</style></head>
<body><main><p style="margin:0 0 20px;font-weight:600;color:#0a0a0a">${esc(BRAND.name)}</p>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

function parse(url: URL) {
  const u = url.searchParams.get("u") ?? "";
  const k = url.searchParams.get("k") ?? "";
  const t = url.searchParams.get("t") ?? "";
  return verifyUnsubscribeToken(u, k, t, requireEnv("AUTH_SECRET")) ? { userId: u, topic: k as EmailTopic } : null;
}

/** GET only shows a confirm button: link scanners that prefetch URLs must not unsubscribe anyone. */
export function GET(req: Request) {
  const url = new URL(req.url);
  const v = parse(url);
  if (!v) return page("Link not valid", `<h1>This link isn't valid</h1><p>Manage email settings from inside ${esc(BRAND.name)} instead.</p><a class="b" href="${esc(appUrl())}/settings/notifications">Open settings</a>`, 400);
  return page(
    "Unsubscribe",
    `<h1>Stop ${esc(LABEL[v.topic])}?</h1><p>You'll still get sign-in codes. You can turn this back on any time in settings.</p>
<form method="post" action="${esc(url.pathname + url.search)}"><button type="submit">Unsubscribe</button></form>`,
  );
}

/** POST: the confirm button, and RFC 8058 one-click (List-Unsubscribe-Post) from mail clients. */
export async function POST(req: Request) {
  const v = parse(new URL(req.url));
  if (!v) return page("Link not valid", `<h1>This link isn't valid</h1>`, 400);
  await db()
    .update(schema.userSettings)
    .set(v.topic === "digest" ? { notifyEmailDigest: false } : { notifyEmail: false })
    .where(eq(schema.userSettings.userId, v.userId));
  return page("Unsubscribed", `<h1>You're unsubscribed</h1><p>No more ${esc(LABEL[v.topic])}. Turn them back on any time in <a href="${esc(appUrl())}/settings/notifications">notification settings</a>.</p>`);
}
