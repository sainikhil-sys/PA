"use client";

import { Bell, DeviceMobile, Desktop, QrCode, Trash, ShareNetwork } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { createPairCode, removeDevice, saveFcmToken, savePushSubscription, sendTestPush } from "@/app/actions/devices";
import { Button } from "@/components/ui/button";
import { appFcmToken, appNotificationsAllowed, inAndroidWebView, inAppilixApp, requestAppNotifications, waitForAppilix } from "@/lib/appilix";
import { timeAgo } from "@/lib/utils";
import { Section } from "./section";

type Device = { id: string; label: string; createdAt: string; lastUsedAt: string | null };

function b64ToBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isIos() {
  return typeof navigator !== "undefined" && /iPhone|iPad/.test(navigator.userAgent);
}
function isStandalone() {
  return typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
}

/** Firebase Cloud Messaging token via OUR service worker (sw.js shows the notification). */
async function fcmToken(config: Record<string, string>, vapidKey: string, reg: ServiceWorkerRegistration): Promise<string | null> {
  const [{ initializeApp, getApps }, { getMessaging, getToken, isSupported }] = await Promise.all([import("firebase/app"), import("firebase/messaging")]);
  if (!(await isSupported())) return null;
  const app = getApps()[0] ?? initializeApp(config);
  return getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: reg });
}

export function DevicesView({ vapidKey, firebase, devices, justPaired }: { vapidKey: string | null; firebase: { config: Record<string, string>; vapidKey: string } | null; devices: Device[]; justPaired: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [qr, setQr] = React.useState<{ svg: string; expiresAt: string } | null>(null);
  const [support, setSupport] = React.useState<"ok" | "app" | "unsupported" | "ios-install" | null>(null);
  const [permission, setPermission] = React.useState<NotificationPermission | null>(null);

  React.useEffect(() => {
    // Inside the installed phone app, notifications go through the app (Firebase), not the browser.
    if (inAppilixApp() || inAndroidWebView()) {
      setSupport("app");
      void waitForAppilix();
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setSupport(isIos() && !isStandalone() ? "ios-install" : "unsupported");
      return;
    }
    setSupport("ok");
    setPermission(Notification.permission);
    void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }, []);

  const [status, setStatus] = React.useState<string | null>(null);
  const fail = (msg: string) => {
    setStatus(msg);
    toast.error(msg);
  };
  const enableInApp = () =>
    start(async () => {
      setStatus(null);
      if (!(await appNotificationsAllowed())) {
        requestAppNotifications();
        setStatus("Allow notifications for Cowork in the screen that opens, then come back here and tap the button again.");
        return;
      }
      const token = await appFcmToken();
      if (!token) return fail("The app couldn't get a notification token yet. Close and reopen Cowork, then try again.");
      const r = await saveFcmToken({ token, nativeApp: true });
      if (!r.ok) return fail(r.error);
      setStatus("This phone is connected. Tap “Send a test” to check.");
      toast.success("This phone will get notifications.");
      router.refresh();
    });

  const enableHere = () =>
    start(async () => {
      setStatus(null);
      try {
        if (!vapidKey && !firebase) return fail("Notifications aren't available right now.");
        const perm = await Notification.requestPermission();
        setPermission(perm);
        if (perm !== "granted") return fail(perm === "denied" ? "Notifications are blocked for this site. Allow them in your browser or phone settings, then try again." : "You didn't allow notifications. Tap the button again and choose Allow.");
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        let fcmError: string | null = null;
        if (firebase) {
          const token = await fcmToken(firebase.config, firebase.vapidKey, reg).catch((e: unknown) => {
            fcmError = e instanceof Error ? e.message : String(e);
            return null;
          });
          if (token) {
            const r = await saveFcmToken({ token });
            if (!r.ok) return fail(r.error);
            setStatus("Connected through Firebase. Tap “Send a test” to check.");
            toast.success("This device will get notifications.");
            return void router.refresh();
          }
        }
        if (!vapidKey) return fail(`This browser couldn't register for notifications${fcmError ? ` (${fcmError})` : ""}.`);
        // A subscription made with a different key can't be reused: replace it.
        let sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe().catch(() => {});
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidKey) as BufferSource });
        const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        const r = await savePushSubscription({ endpoint: json.endpoint, keys: json.keys });
        if (!r.ok) return fail(r.error);
        setStatus("Connected. Tap “Send a test” to check.");
        toast.success("This device will get notifications.");
        router.refresh();
      } catch (e) {
        fail(`Couldn't turn on notifications: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

  return (
    <div>
      {justPaired ? (
        <div className="mb-5 rounded-[14px] border border-border bg-surface p-4 text-[14px]">
          <p className="font-medium">Phone paired.</p>
          <p className="mt-1 text-muted">Now turn on notifications below{isIos() ? ", after adding Cowork to your Home Screen" : ""}.</p>
        </div>
      ) : null}

      <AppCheck />
      <Section title="This device" description="Get reminders, urgent mail and announcements as notifications.">
        {support === "ios-install" ? (
          <div className="flex items-start gap-3 rounded-[14px] border border-border p-4 text-[13px]">
            <ShareNetwork size={20} className="mt-0.5 shrink-0" />
            <p>
              On iPhone, tap <strong>Share</strong> then <strong>Add to Home Screen</strong>, open Cowork from your Home Screen, and come back here to turn on notifications.
            </p>
          </div>
        ) : support === "unsupported" ? (
          <p className="text-[13px] text-muted">This browser doesn&apos;t support notifications.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={support === "app" ? enableInApp : enableHere} disabled={pending || (support !== "ok" && support !== "app")}>
              <Bell /> {permission === "granted" ? "Re-connect this device" : "Turn on notifications here"}
            </Button>
            {devices.length ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await sendTestPush({});
                    if (!r.ok) toast.error(r.error);
                    else toast.success(`Sent to ${r.data.devices} device${r.data.devices === 1 ? "" : "s"}`);
                  })
                }
              >
                Send a test
              </Button>
            ) : null}
            {status ? <p className="basis-full text-[13px] text-muted" aria-live="polite">{status}</p> : null}
          </div>
        )}
      </Section>

      <Section title="Pair a phone" description="Scan with your phone's camera to sign in there and get notifications. Only scan it with your own phone.">
        {qr ? (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <div className="size-[180px] rounded-[14px] border border-border bg-white p-2 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr.svg }} />
            <div className="text-[13px] text-muted">
              <p>Valid for 10 minutes, works once.</p>
              <p className="mt-1">Then tap “Turn on notifications here” on the phone.</p>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setQr(null)}>
                Hide code
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="secondary"
            className="w-fit"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await createPairCode({});
                if (!r.ok) return void toast.error(r.error);
                setQr({ svg: r.data.svg, expiresAt: r.data.expiresAt });
              })
            }
          >
            <QrCode /> Show pairing code
          </Button>
        )}
      </Section>

      <Section title="Paired devices">
        {devices.length === 0 ? (
          <p className="text-[13px] text-muted">No devices yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-[14px] border border-border">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                {/iPhone|Android/.test(d.label) ? <DeviceMobile size={20} /> : <Desktop size={20} />}
                <div className="min-w-0 flex-1 text-[13px]">
                  <p className="truncate font-medium">{d.label}</p>
                  <p className="text-muted">Added {timeAgo(d.createdAt)}{d.lastUsedAt ? ` · last notified ${timeAgo(d.lastUsedAt)}` : ""}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${d.label}`}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await removeDevice({ id: d.id });
                      if (!r.ok) return void toast.error(r.error);
                      router.refresh();
                    })
                  }
                >
                  <Trash />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/** Step-by-step check for the installed phone app, so a failure shows exactly where it stops. */
function AppCheck() {
  const [rows, setRows] = React.useState<{ label: string; ok: boolean | null; note?: string }[] | null>(null);
  const [running, setRunning] = React.useState(false);
  const run = React.useCallback(async () => {
    setRunning(true);
    const out: { label: string; ok: boolean | null; note?: string }[] = [];
    const webView = inAndroidWebView();
    const inApp = inAppilixApp() || (await waitForAppilix(8000));
    out.push({
      label: "Running inside the Cowork phone app",
      ok: inApp,
      note: inApp
        ? undefined
        : webView
          ? "This is inside an Android app, but the Appilix bridge isn't available. Turn on the JavaScript Bridge / Firebase notifications for this app in Appilix, rebuild, and reinstall."
          : "This page is open in a normal browser, not the Cowork app. Open the Cowork app itself and check again.",
    });
    if (inApp) {
      const allowed = await appNotificationsAllowed();
      out.push({ label: "Notifications allowed for the app", ok: allowed, note: allowed ? undefined : "Tap “Turn on notifications here” and allow Cowork in the phone settings." });
      const token = allowed ? await appFcmToken() : null;
      out.push({ label: "Firebase token received", ok: allowed ? Boolean(token) : null, note: allowed && !token ? "Firebase isn't connected in this build. Upload google-services.json in Appilix and rebuild the app." : undefined });
    }
    setRows(out);
    setRunning(false);
  }, []);
  React.useEffect(() => {
    if (inAppilixApp() || inAndroidWebView()) void run();
  }, [run]);
  return (
    <Section title="Phone app check" description="Shows each step needed for notifications in the installed app.">
      {rows ? (
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {rows.map((r) => (
            <li key={r.label} className="flex flex-col">
              <span className="flex items-center gap-2">
                <span aria-hidden className={r.ok === true ? "text-success" : r.ok === false ? "text-danger" : "text-muted"}>{r.ok === true ? "✓" : r.ok === false ? "✕" : "–"}</span>
                {r.label}
              </span>
              {r.note ? <span className="pl-5 text-muted">{r.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <Button size="sm" variant="secondary" className="w-fit" disabled={running} onClick={() => void run()}>
        {running ? "Checking…" : rows ? "Check again" : "Run check"}
      </Button>
    </Section>
  );
}
