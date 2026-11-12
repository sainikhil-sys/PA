import * as React from "react";
import { AppState } from "react-native";
import { useSession } from "@/lib/session";
import { endAdminSession } from "./api";
import { useBiometricPreference } from "./biometric";
import { shouldBiometricLock, useAdminToken } from "./token-store";

/**
 * Mounted once in the root layout. Signing out ends the admin session; with the biometric lock on,
 * coming back after 5 minutes or more in the background closes the gate on the admin area.
 */
export function useAdminLifecycle() {
  const status = useSession((s) => s.status);

  React.useEffect(() => {
    if (status === "signedOut") endAdminSession();
  }, [status]);

  React.useEffect(() => {
    void useBiometricPreference.getState().load();
    const sub = AppState.addEventListener("change", (next) => {
      const s = useAdminToken.getState();
      if (!s.token) return;
      if (next !== "active") {
        if (s.backgroundedAt === null) s.setBackgrounded(Date.now());
        return;
      }
      if (shouldBiometricLock(useBiometricPreference.getState().enabled, s.backgroundedAt, Date.now())) s.setBiometricLocked(true);
      s.setBackgrounded(null);
    });
    return () => sub.remove();
  }, []);
}
