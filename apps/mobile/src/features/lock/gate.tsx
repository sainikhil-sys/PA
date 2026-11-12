import * as ScreenCapture from "expo-screen-capture";
import * as React from "react";
import { View } from "react-native";
import { useSession } from "@/lib/session";
import type { Scheme } from "@/theme/tokens";
import { useLockLifecycle } from "./lifecycle";
import { LockScreen, PrivacyCover } from "./lock-screen";
import { useLock } from "./store";

const CAPTURE_KEY = "cowork.lock";

/**
 * Wraps the app with App lock. The app stays mounted underneath (so unlocking returns to the same
 * screen), but while locked or covered it sits behind an opaque cover and is hidden from screen
 * readers. On a fresh launch the launch animation plays first (`launched` is false until it hands
 * over); the lock screen and its biometric prompt follow.
 */
export function LockGate({ launched, scheme, children }: { launched: boolean; scheme: Scheme; children: React.ReactNode }) {
  const status = useSession((s) => s.status);
  const loaded = useLock((s) => s.loaded);
  const enabled = useLock((s) => s.enabled);
  const locked = useLock((s) => s.locked);
  const covered = useLock((s) => s.covered);
  const hideInRecents = useLock((s) => s.hideInRecents);
  const load = useLock((s) => s.load);
  const clear = useLock((s) => s.clear);

  const signedIn = status === "signedIn";
  const lockOn = signedIn && enabled;

  React.useEffect(() => {
    void load();
  }, [load]);

  // App lock belongs to the signed-in session: signing out (or an expired session) turns it off,
  // so the next sign-in on this phone starts without it.
  React.useEffect(() => {
    if (loaded && status === "signedOut") void clear();
  }, [loaded, status, clear]);

  // FLAG_SECURE on Android (blank recents thumbnail, no screenshots), only while signed in.
  React.useEffect(() => {
    const op = signedIn && hideInRecents ? ScreenCapture.preventScreenCaptureAsync(CAPTURE_KEY) : ScreenCapture.allowScreenCaptureAsync(CAPTURE_KEY);
    void op.catch(() => {});
  }, [signedIn, hideInRecents]);

  useLockLifecycle(lockOn);

  const showLock = lockOn && locked;
  // Until the lock settings are read, a signed-in app stays covered rather than flashing content.
  const hidden = (signedIn && !loaded) || showLock || (lockOn && covered);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }} importantForAccessibility={hidden ? "no-hide-descendants" : "auto"} accessibilityElementsHidden={hidden}>
        {children}
      </View>
      {hidden ? <PrivacyCover key={`cover-${scheme}`} /> : null}
      {showLock && launched ? <LockScreen key={`lock-${scheme}`} canPrompt={launched} /> : null}
    </View>
  );
}
