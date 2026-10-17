import "server-only";
import { GoogleAuth } from "google-auth-library";
import { appUrl, env } from "@/lib/env";
import { errMessage, log } from "@/lib/log";

/** Firebase Cloud Messaging (HTTP v1). Enabled when FIREBASE_SERVICE_ACCOUNT holds the service-account JSON. */
type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let account: ServiceAccount | null | undefined;
let auth: GoogleAuth | undefined;

function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  const raw = env().FIREBASE_SERVICE_ACCOUNT;
  try {
    const parsed = raw ? (JSON.parse(raw) as ServiceAccount) : null;
    account = parsed?.project_id && parsed.client_email && parsed.private_key ? parsed : null;
  } catch {
    log.warn("fcm.bad_service_account", {});
    account = null;
  }
  return account;
}

export function fcmConfigured(): boolean {
  return serviceAccount() !== null;
}

/** Send one notification to one FCM registration token. "dead" means the token should be removed. */
export async function sendFcm(token: string, msg: { title: string; body: string; href: string; tag?: string }, opts: { nativeApp?: boolean } = {}): Promise<"ok" | "dead" | "error"> {
  const sa = serviceAccount();
  if (!sa) return "error";
  try {
    auth ??= new GoogleAuth({ credentials: { client_email: sa.client_email, private_key: sa.private_key }, scopes: ["https://www.googleapis.com/auth/firebase.messaging"] });
    const access = await auth.getAccessToken();
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: opts.nativeApp
          ? {
              // Phone app (Appilix): Android shows "notification" itself; the link rides along in data.
              token,
              notification: { title: msg.title, body: msg.body },
              data: { href: msg.href, url: `${appUrl()}${msg.href}`, tag: msg.tag ?? "" },
              android: { priority: "high", notification: { tag: msg.tag || undefined, default_sound: true } },
            }
          : {
              token,
              // Data-only payload: our service worker (sw.js) shows it, same as standard Web Push.
              data: { title: msg.title, body: msg.body, href: msg.href, tag: msg.tag ?? "" },
              webpush: { headers: { TTL: "43200", Urgency: "normal" } },
              android: { priority: "high" },
            },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return "ok";
    const text = await res.text();
    if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(text)) return "dead";
    log.warn("fcm.send_failed", { status: res.status, detail: text.slice(0, 200) });
    return "error";
  } catch (err) {
    log.warn("fcm.send_failed", { error: errMessage(err) });
    return "error";
  }
}
