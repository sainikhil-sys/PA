"use client";

import * as React from "react";
import { saveFcmToken } from "@/app/actions/devices";
import { appFcmToken, appNotificationsAllowed, inAndroidWebView, inAppilixApp, recordAppUser, waitForAppilix } from "@/lib/appilix";

const KEY = "pa:app-fcm-token";

/**
 * Inside the installed phone app (Appilix): link this phone to the signed-in account and keep its
 * Firebase token registered, on open and whenever the app comes back to the foreground (for example
 * after the person allowed notifications in the phone's settings). Renders nothing.
 */
export function AppilixSync({ email }: { email: string }) {
  React.useEffect(() => {
    let busy = false;
    let cancelled = false;
    const sync = async () => {
      if (busy) return;
      busy = true;
      try {
        await recordAppUser(email);
        if (!(await appNotificationsAllowed())) return;
        const token = await appFcmToken();
        if (!token) return;
        let last: string | null = null;
        try {
          last = localStorage.getItem(KEY);
        } catch {}
        if (last === token) return;
        const r = await saveFcmToken({ token, nativeApp: true });
        if (r.ok) {
          try {
            localStorage.setItem(KEY, token);
          } catch {}
        }
      } finally {
        busy = false;
      }
    };
    const onVisible = () => document.visibilityState === "visible" && inAppilixApp() && void sync();
    document.addEventListener("visibilitychange", onVisible);
    // The bridge may appear a moment after load; only worth waiting inside an app WebView.
    void (async () => {
      if ((inAppilixApp() || (inAndroidWebView() && (await waitForAppilix()))) && !cancelled) void sync();
    })();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [email]);
  return null;
}
