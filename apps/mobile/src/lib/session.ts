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
    const [token, step] = await Promise.all([SecureStore.getItemAsync(TOKEN_KEY), SecureStore.getItemAsync(ONBOARDING_KEY)]);
    set({ token, status: token ? "signedIn" : "signedOut", onboarding: (step as OnboardingStep | null) ?? "done" });
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
    if (opts?.remote && get().token) {
      // Lazy import: push.ts imports this module's api client, so avoid a load-order cycle.
      const { disablePush } = await import("./push");
      await disablePush().catch(() => {});
      await api("/api/mobile/auth/sign-out", { method: "POST" }).catch(() => {});
    }
    await Promise.all([SecureStore.deleteItemAsync(TOKEN_KEY), SecureStore.deleteItemAsync(ONBOARDING_KEY)]);
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
