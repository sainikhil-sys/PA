import { create } from "zustand";

/**
 * The admin session on this phone (docs/ADMIN_CONSOLE_PROPOSAL.md 2.4). The token the step-up returns
 * lives in memory only: no persist middleware, no AsyncStorage, no SecureStore. Restarting the app,
 * signing out, locking, or any `step_up_required` answer ends it. tests/admin.test.ts
 * checks this module never persists.
 *
 * The biometric lock is a separate client gate (see ./biometric.ts); the server never sees it.
 */

/** Header the server reads the admin token from. */
export const ADMIN_HEADER = "X-Cowork-Admin";

/** Lock the admin area after this long in the background, when the biometric lock is on. */
export const BIOMETRIC_LOCK_AFTER_MS = 5 * 60_000;

type State = {
  token: string | null;
  expiresAt: string | null;
  /** Why the console asked for the code again (an ended session, a fresh unlock for owner actions). */
  notice: string | null;
  /** When the app last went to the background while the console was unlocked. */
  backgroundedAt: number | null;
  /** The biometric gate is closed: the token is kept, but the screens stay covered until it opens. */
  biometricLocked: boolean;
  unlock: (token: string, expiresAt: string | null) => void;
  end: (notice?: string | null) => void;
  setBackgrounded: (at: number | null) => void;
  setBiometricLocked: (locked: boolean) => void;
};

export const useAdminToken = create<State>((set) => ({
  token: null,
  expiresAt: null,
  notice: null,
  backgroundedAt: null,
  biometricLocked: false,
  unlock: (token, expiresAt) => set({ token, expiresAt, notice: null, backgroundedAt: null, biometricLocked: false }),
  end: (notice = null) => set({ token: null, expiresAt: null, notice, backgroundedAt: null, biometricLocked: false }),
  setBackgrounded: (backgroundedAt) => set({ backgroundedAt }),
  setBiometricLocked: (biometricLocked) => set({ biometricLocked }),
}));

/** The header to send on admin requests, or nothing when the console is locked. */
export function adminHeaders(token: string | null): Record<string, string> {
  return token ? { [ADMIN_HEADER]: token } : {};
}

/** True when the biometric gate should close after the app returns from the background. */
export function shouldBiometricLock(enabled: boolean, backgroundedAt: number | null, now: number): boolean {
  if (!enabled || backgroundedAt === null) return false;
  return now - backgroundedAt >= BIOMETRIC_LOCK_AFTER_MS;
}
