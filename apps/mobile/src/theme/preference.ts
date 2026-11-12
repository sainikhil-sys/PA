import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";
import { create } from "zustand";
import type { Scheme } from "./tokens";

/** Appearance: follow the phone, or always light or dark. Stored on this phone. */
export type ThemePreference = "system" | "light" | "dark";

/** Motion: follow the phone's animation setting, or always keep movement to a minimum. */
export type MotionPreference = "system" | "reduce";

const KEY = "cowork.theme";
const HAPTICS_KEY = "cowork.haptics";
const MOTION_KEY = "cowork.motion";

type State = {
  preference: ThemePreference;
  /** Vibration feedback on taps and errors. On by default. */
  haptics: boolean;
  motion: MotionPreference;
  loaded: boolean;
  load: () => Promise<void>;
  setPreference: (p: ThemePreference) => Promise<void>;
  setHaptics: (on: boolean) => Promise<void>;
  setMotion: (m: MotionPreference) => Promise<void>;
};

export const useThemePreference = create<State>((set) => ({
  preference: "system",
  haptics: true,
  motion: "system",
  loaded: false,
  load: async () => {
    const [stored, haptics, motion] = await Promise.all([KEY, HAPTICS_KEY, MOTION_KEY].map((k) => AsyncStorage.getItem(k).catch(() => null)));
    set({ preference: stored === "light" || stored === "dark" ? stored : "system", haptics: haptics !== "off", motion: motion === "reduce" ? "reduce" : "system", loaded: true });
  },
  setPreference: async (preference) => {
    set({ preference });
    await AsyncStorage.setItem(KEY, preference).catch(() => {});
  },
  setHaptics: async (on) => {
    set({ haptics: on });
    await AsyncStorage.setItem(HAPTICS_KEY, on ? "on" : "off").catch(() => {});
  },
  setMotion: async (motion) => {
    set({ motion });
    await AsyncStorage.setItem(MOTION_KEY, motion).catch(() => {});
  },
}));

/** The scheme to render now: the saved choice, or the phone's setting (light when it reports none). */
export function useScheme(): Scheme {
  const system = useColorScheme();
  const preference = useThemePreference((s) => s.preference);
  if (preference !== "system") return preference;
  return system === "dark" ? "dark" : "light";
}
