import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { api, configureAuth } from "./api";

/**
 * The signed-in session. The token lives in the Android Keystore-backed SecureStore, never in
 * plain storage or logs. Onboarding progress is kept too, so an interrupted setup resumes.
 */
const TOKEN_KEY = "cowork.session";
const ONBOARDING_KEY = "cowork.onboarding";
const EMAIL_KEY = "cowork.pendingEmail";
/** Written by Settings > Phone link when this phone is linked. */
export const PHONE_DEVICE_KEY = "cowork.phoneDeviceId";

export type OnboardingStep = "profile" | "privacy" | "permissions" | "first-chat" | "done";
export const ONBOARDING_ORDER: OnboardingStep[] = ["profile", "privacy", "permissions", "first-chat", "done"];

type State = {
  status: "restoring" | "signedOut" | "signedIn";
  token: string | null;
  onboarding: OnboardingStep;
  /** Set when the server rejected the token (expired or revoked), to explain the sign-out. */
  expired: boolean;
  restore: () => Promise<void>;
  signIn: (token: string, isNewAccount: boolean) => Promise<void>;
  setOnboarding: (step: OnboardingStep) => Promise<void>;
  signOut: (opts?: { remote?: boolean }) => Promise<void>;
  markExpired: () => void;
};

export const useSession = create<State>((set, get) => ({
  status: "restoring",
  token: null,
  onboarding: "done",
  expired: false,

  restore: async () => {
    try {
      const [token, step] = await Promise.all([SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(ONBOARDING_KEY)]);
      set({ token, status: token ? "signedIn" : "signedOut", onboarding: (step as OnboardingStep | null) ?? "done" });
    } catch {
      // Unreadable secure storage (for example after a restore to another phone): start signed out
      // rather than leaving the splash screen up.
      await Promise.all([TOKEN_KEY, ONBOARDING_KEY].map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
      set({ token: null, status: "signedOut", onboarding: "done" });
    }
  },

  signIn: async (token, isNewAccount) => {
    const onboarding: OnboardingStep = isNewAccount ? "profile" : "done";
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(ONBOARDING_KEY, onboarding);
    await SecureStore.deleteItemAsync(EMAIL_KEY);
    set({ token, status: "signedIn", onboarding, expired: false });
  },

  setOnboarding: async (step) => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, step);
    set({ onboarding: step });
  },

  signOut: async (opts) => {
    // Lazy imports: push.ts and phone-link use this module's api client, so avoid a load-order cycle.
    const [{ disablePush, forgetPushLocally }, { default: PhoneLink }] = await Promise.all([import("./push"), import("./phone-link")]);
    if (opts?.remote && get().token) {
      // Still signed in: remove this phone's push token and Phone link on the server, then revoke the session.
      await disablePush().catch(() => {});
      const deviceId = await SecureStore.getItemAsync(PHONE_DEVICE_KEY).catch(() => null);
      if (deviceId) await api("/api/mobile/phone", { method: "DELETE", body: { deviceId } }).catch(() => {});
      await api("/api/mobile/auth/sign-out", { method: "POST" }).catch(() => {});
    }
    // Every sign-out, including an expired or revoked session: stop forwarding notifications and stop
    // receiving pushes for this account, so the next person to sign in on this phone inherits nothing.
    PhoneLink.clearLink();
    await forgetPushLocally().catch(() => {});
    await Promise.all([TOKEN_KEY, ONBOARDING_KEY, PHONE_DEVICE_KEY].map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
    set({ token: null, status: "signedOut", onboarding: "done" });
  },

  markExpired: () => {
    if (get().status !== "signedIn") return;
    set({ expired: true });
    void get().signOut();
  },
}));

configureAuth({ token: () => useSession.getState().token, onUnauthorized: () => useSession.getState().markExpired() });

/** The email typed on the sign-in screen, so the code screen survives the app being backgrounded. */
export const pendingEmail = {
  get: () => SecureStore.getItemAsync(EMAIL_KEY),
  set: (email: string) => SecureStore.setItemAsync(EMAIL_KEY, email),
};
