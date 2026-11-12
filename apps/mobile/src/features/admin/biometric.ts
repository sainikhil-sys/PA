import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { create } from "zustand";

/**
 * Optional biometric lock for the admin console. A lock on this phone only: the server can't check a
 * fingerprint, so it still requires the admin code. Only the on/off preference is stored, never a token.
 */
const KEY = "cowork.adminBiometric";

type State = {
  enabled: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
};

export const useBiometricPreference = create<State>((set) => ({
  enabled: false,
  loaded: false,
  load: async () => {
    const v = await AsyncStorage.getItem(KEY).catch(() => null);
    set({ enabled: v === "on", loaded: true });
  },
  setEnabled: async (enabled) => {
    set({ enabled });
    await AsyncStorage.setItem(KEY, enabled ? "on" : "off").catch(() => {});
  },
}));

/** Null when this phone can use it, otherwise a sentence saying why not. */
export async function biometricUnavailable(): Promise<string | null> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync())) return "This phone has no fingerprint or face unlock.";
    if (!(await LocalAuthentication.isEnrolledAsync())) return "Set up a fingerprint or face unlock in your phone's settings first.";
    return null;
  } catch {
    return "Biometric unlock isn't available on this phone.";
  }
}

/** Shows the system prompt. True when the person passed it. */
export async function confirmBiometric(promptMessage: string): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: "Cancel" });
    return r.success;
  } catch {
    return false;
  }
}
