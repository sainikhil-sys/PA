import * as React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { shouldLockOnReturn } from "./logic";
import { useLock } from "./store";

/** A JS timer gap longer than this means the app was suspended, even if no background event arrived. */
const HEARTBEAT_MS = 5_000;
const SUSPENDED_GAP_MS = 15_000;
/** App-state changes this soon after a biometric or screen-lock prompt closes belong to the prompt. */
const AUTH_SETTLE_MS = 1_500;

/**
 * Decides when the lock comes back after Cowork leaves the screen. Three signals, so one missed
 * callback does not leave the app open:
 *   - "inactive" (iOS app switcher, Control Center) starts the clock and shows the privacy cover;
 *   - "background" confirms Cowork really left (the earliest of the two times counts);
 *   - a 5 second heartbeat: a gap in it on return means the JS thread was suspended.
 * The system biometric prompt and the phone's screen lock fallback also move Cowork out of the
 * foreground; while one is open, these changes are ignored.
 */
export function useLockLifecycle(active: boolean) {
  React.useEffect(() => {
    if (!active) return;
    let leftAt: number | null = null;
    let backgroundAt: number | null = null;
    let lastTick = Date.now();

    const tick = setInterval(() => {
      if (AppState.currentState === "active") lastTick = Date.now();
    }, HEARTBEAT_MS);

    const onChange = (next: AppStateStatus) => {
      const s = useLock.getState();
      const now = Date.now();
      // Coming back from the system prompt (or just after it closed) is not coming back to Cowork.
      const fromPrompt = s.authenticating || now - s.authEndedAt < AUTH_SETTLE_MS;
      if (next === "active") {
        const suspendedSince = now - lastTick > SUSPENDED_GAP_MS ? lastTick : null;
        const awaySince = backgroundAt ?? suspendedSince;
        leftAt = null;
        backgroundAt = null;
        lastTick = now;
        if (!fromPrompt && shouldLockOnReturn(s.policy, awaySince, now)) s.lock();
        s.setCovered(false);
        s.setForeground(true);
        return;
      }
      s.setForeground(false);
      if (s.authenticating) return;
      leftAt ??= now;
      s.setCovered(true);
      if (next === "background") {
        backgroundAt ??= leftAt;
        // Lock right away so the lock screen, not the app, is what comes back.
        if (s.policy === "immediate") s.lock();
      }
    };

    const sub = AppState.addEventListener("change", onChange);
    return () => {
      sub.remove();
      clearInterval(tick);
    };
  }, [active]);
}
