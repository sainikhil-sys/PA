import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";
import { create } from "zustand";
import type { Scheme } from "./tokens";

/** Appearance: follow the phone, or always light or dark. Stored on this phone. */
export type ThemePreference = "system" | "light" | "dark";

const KEY = "cowork.theme";

type State = {
  preference: ThemePreference;
  loaded: boolean;
  load: () => Promise<void>;
  setPreference: (p: ThemePreference) => Promise<void>;
};

export const useThemePreference = create<State>((set) => ({
  preference: "system",
  loaded: false,
  load: async () => {
    const stored = await AsyncStorage.getItem(KEY).catch(() => null);
    set({ preference: stored === "light" || stored === "dark" ? stored : "system", loaded: true });
  },
  setPreference: async (preference) => {
    set({ preference });
    await AsyncStorage.setItem(KEY, preference).catch(() => {});
  },
}));

/** The scheme to render now: the saved choice, or the phone's setting (light when it reports none). */
export function useScheme(): Scheme {
  const system = useColorScheme();
  const preference = useThemePreference((s) => s.preference);
  if (preference !== "system") return preference;
  return system === "dark" ? "dark" : "light";
}
