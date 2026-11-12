import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { authenticate, type BiometricOutcome } from "./biometrics";
import {
  encodeRecord,
  hashPin,
  isPinLength,
  isPolicy,
  isValidPin,
  NO_ATTEMPTS,
  parseAttempts,
  parseRecord,
  registerFailure,
  remainingLockoutMs,
  SALT_BYTES,
  verifyPin,
  type Attempts,
  type LockPolicy,
  type PinLength,
} from "./logic";

/**
 * App lock state. Everything lives in SecureStore (Android Keystore-backed), never AsyncStorage:
 * the PIN as a salted PBKDF2 record, the wrong-PIN count and wait (so a restart does not reset
 * them), and the small preferences record.
 */
const PIN_KEY = "cowork.lock.pin";
const CONFIG_KEY = "cowork.lock.config";
const ATTEMPTS_KEY = "cowork.lock.attempts";
const KEYS = [PIN_KEY, CONFIG_KEY, ATTEMPTS_KEY];
const STORE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export type LockConfig = {
  enabled: boolean;
  pinLength: PinLength;
  biometrics: boolean;
  policy: LockPolicy;
  /** Sets FLAG_SECURE: blank thumbnail in recent apps and no screenshots. */
  hideInRecents: boolean;
};

const DEFAULT_CONFIG: LockConfig = { enabled: false, pinLength: 4, biometrics: false, policy: "1m", hideInRecents: false };

function parseConfig(raw: string | null): LockConfig {
  if (!raw) return DEFAULT_CONFIG;
  try {
    const v = JSON.parse(raw) as Partial<LockConfig>;
    return {
      enabled: v.enabled === true,
      pinLength: isPinLength(v.pinLength) ? v.pinLength : 4,
      biometrics: v.biometrics === true,
      policy: isPolicy(v.policy) ? v.policy : DEFAULT_CONFIG.policy,
      hideInRecents: v.hideInRecents === true,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export type PinCheck = { result: "ok" } | { result: "wrong"; attempts: Attempts } | { result: "wait"; ms: number };

type State = LockConfig & {
  loaded: boolean;
  /** The lock screen is up. */
  locked: boolean;
  /** Cowork is leaving the screen: an opaque cover hides it from the app switcher. */
  covered: boolean;
  /** Cowork is in the foreground (the biometric prompt can only open then). */
  foreground: boolean;
  /** A system prompt (biometrics or the phone's screen lock) is open; leaving for it is not leaving Cowork. */
  authenticating: boolean;
  /** When the last system prompt closed. */
  authEndedAt: number;
  /** Counts lock events, so the biometric prompt opens once per lock. */
  lockSeq: number;
  promptedSeq: number;
  attempts: Attempts;

  load: () => Promise<void>;
  lock: () => void;
  unlock: () => void;
  setCovered: (covered: boolean) => void;
  setForeground: (foreground: boolean) => void;
  markPrompted: () => void;
  /** Checks a PIN, counting it as wrong before the slow check so closing the app cannot skip the count. */
  checkPin: (pin: string) => Promise<PinCheck>;
  /** Saves a new PIN (and its length) and turns the lock on. */
  setPin: (pin: string, length: PinLength) => Promise<void>;
  setPolicy: (policy: LockPolicy) => Promise<void>;
  setBiometrics: (on: boolean) => Promise<void>;
  setHideInRecents: (on: boolean) => Promise<void>;
  /** Runs the biometric prompt with app-state tracking paused. */
  biometric: (promptMessage: string) => Promise<BiometricOutcome>;
  /** Turns the lock off and forgets the PIN and attempts. Keeps nothing. */
  clear: () => Promise<void>;
};

function configOf(s: LockConfig): LockConfig {
  return { enabled: s.enabled, pinLength: s.pinLength, biometrics: s.biometrics, policy: s.policy, hideInRecents: s.hideInRecents };
}

export const useLock = create<State>((set, get) => {
  async function saveConfig(patch: Partial<LockConfig>) {
    const next = { ...configOf(get()), ...patch };
    await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(next), STORE_OPTS);
    set(patch);
  }
  async function saveAttempts(attempts: Attempts) {
    await SecureStore.setItemAsync(ATTEMPTS_KEY, JSON.stringify(attempts), STORE_OPTS);
    set({ attempts });
  }

  return {
    ...DEFAULT_CONFIG,
    loaded: false,
    locked: false,
    covered: false,
    foreground: true,
    authenticating: false,
    authEndedAt: 0,
    lockSeq: 0,
    promptedSeq: -1,
    attempts: NO_ATTEMPTS,

    load: async () => {
      if (get().loaded) return;
      try {
        const [rawPin, rawConfig, rawAttempts] = await Promise.all(KEYS.map((k) => SecureStore.getItemAsync(k, STORE_OPTS)));
        const config = parseConfig(rawConfig ?? null);
        // A lock without a readable PIN record cannot be opened with a PIN: treat it as off.
        const enabled = config.enabled && parseRecord(rawPin ?? null) !== null;
        // A fresh launch always locks when the lock is on.
        set({ ...config, enabled, attempts: parseAttempts(rawAttempts ?? null), locked: enabled, lockSeq: enabled ? 1 : 0, loaded: true });
      } catch {
        // Unreadable secure storage (for example after a restore to another phone). The session in
        // the same store is unreadable too, so the person signs in again; start with the lock off.
        await Promise.all(KEYS.map((k) => SecureStore.deleteItemAsync(k, STORE_OPTS).catch(() => {})));
        set({ ...DEFAULT_CONFIG, attempts: NO_ATTEMPTS, locked: false, loaded: true });
      }
    },

    lock: () => {
      const s = get();
      if (!s.enabled || s.locked) return;
      set({ locked: true, lockSeq: s.lockSeq + 1 });
    },
    unlock: () => set({ locked: false, covered: false }),
    setCovered: (covered) => {
      if (get().covered !== covered) set({ covered });
    },
    setForeground: (foreground) => {
      if (get().foreground !== foreground) set({ foreground });
    },
    markPrompted: () => set({ promptedSeq: get().lockSeq }),

    checkPin: async (pin) => {
      const now = Date.now();
      const before = get().attempts;
      const wait = remainingLockoutMs(before, now);
      if (wait > 0) return { result: "wait", ms: wait };
      const record = parseRecord(await SecureStore.getItemAsync(PIN_KEY, STORE_OPTS));
      if (!record) return { result: "wrong", attempts: before };
      // Count first: if the app is closed during the slow check, the attempt still counts.
      const counted = registerFailure(before, now);
      await saveAttempts(counted);
      if (await verifyPin(pin, record)) {
        await saveAttempts(NO_ATTEMPTS);
        return { result: "ok" };
      }
      return { result: "wrong", attempts: counted };
    },

    setPin: async (pin, length) => {
      if (!isValidPin(pin, length)) throw new Error("A PIN is 4 or 6 digits.");
      const salt = await Crypto.getRandomBytesAsync(SALT_BYTES);
      const record = await hashPin(pin, salt);
      await SecureStore.setItemAsync(PIN_KEY, encodeRecord(record), STORE_OPTS);
      await saveAttempts(NO_ATTEMPTS);
      await saveConfig({ enabled: true, pinLength: length });
    },

    setPolicy: (policy) => saveConfig({ policy }),
    setBiometrics: (biometrics) => saveConfig({ biometrics }),
    setHideInRecents: (hideInRecents) => saveConfig({ hideInRecents }),

    biometric: async (promptMessage) => {
      set({ authenticating: true });
      try {
        return await authenticate(promptMessage);
      } finally {
        // The phone's own screen-lock fallback is a separate screen, so Cowork's return to the
        // foreground can arrive just after this; the lifecycle ignores it (see AUTH_SETTLE_MS).
        set({ authenticating: false, authEndedAt: Date.now() });
      }
    },

    clear: async () => {
      await Promise.all(KEYS.map((k) => SecureStore.deleteItemAsync(k, STORE_OPTS).catch(() => {})));
      set({ ...DEFAULT_CONFIG, attempts: NO_ATTEMPTS, locked: false, covered: false });
    },
  };
});
