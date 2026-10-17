/**
 * Appilix JavaScript bridge (https://appilix.com/docs): present only when Cowork runs inside the
 * Appilix Android/iOS app (a WebView, where browser push isn't available). Client-only helpers.
 */
type Bridge = { postMessage: (msg: string) => void; onmessage: ((e: { data: string }) => void) | null };

function bridge(): Bridge | null {
  return typeof window !== "undefined" && typeof (window as unknown as { appilix?: Bridge }).appilix !== "undefined" ? (window as unknown as { appilix: Bridge }).appilix : null;
}

export function inAppilixApp(): boolean {
  return bridge() !== null;
}

/** One request/response over the bridge (it has a single onmessage slot, so calls run one at a time). */
let queue: Promise<unknown> = Promise.resolve();
function call<T = Record<string, unknown>>(type: string, props?: Record<string, unknown>, timeoutMs = 8000): Promise<T | null> {
  const b = bridge();
  if (!b) return Promise.resolve(null);
  const run = () =>
    new Promise<T | null>((resolve) => {
      const done = (v: T | null) => {
        clearTimeout(timer);
        b.onmessage = null;
        resolve(v);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      b.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data) as { type?: string } & T;
          if (data.type === type) done(data);
        } catch {}
      };
      b.postMessage(JSON.stringify(props ? { type, props } : { type }));
    });
  const p = queue.then(run, run);
  queue = p.catch(() => null);
  return p;
}

export async function appNotificationsAllowed(): Promise<boolean> {
  const r = await call<{ status?: boolean }>("firebase_notification_permission_status");
  return r?.status === true;
}

/** Shows the app's own prompt; "Allow" opens the phone's notification settings for the app. */
export function requestAppNotifications(): void {
  bridge()?.postMessage(
    JSON.stringify({
      type: "firebase_notification_permission",
      props: { description: "Get reminders, urgent mail and updates from Cowork.", allow_btn_text: "Allow", cancel_btn_text: "Not now" },
    }),
  );
}

/** The phone's Firebase Cloud Messaging token ("" until notifications are allowed). */
export async function appFcmToken(): Promise<string | null> {
  const r = await call<{ token?: string }>("firebase_token");
  return r?.token ? r.token : null;
}

/** Tell Appilix which Cowork account this phone belongs to (lets their dashboard target it too). */
export async function recordAppUser(identity: string): Promise<boolean> {
  const r = await call<{ response?: { status?: boolean } }>("firebase_record_user_identity", { user_identity: identity });
  return r?.response?.status === true;
}
