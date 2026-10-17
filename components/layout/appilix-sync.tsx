"use client";

import * as React from "react";
import { saveFcmToken } from "@/app/actions/devices";
import { appFcmToken, appNotificationsAllowed, inAppilixApp, recordAppUser } from "@/lib/appilix";

const KEY = "pa:app-fcm-token";

/**
 * Inside the installed phone app (Appilix): link this phone to the signed-in account and keep its
 * Firebase token registered, on open and whenever the app comes back to the foreground (for example
 * after the person allowed notifications in the phone's settings). Renders nothing.
 */
export function AppilixSync({ email }: { email: string }) {
  React.useEffect(() => {
    if (!inAppilixApp()) return;
    let busy = false;
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
    void sync();
    const onVisible = () => document.visibilityState === "visible" && void sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [email]);
  return null;
}
