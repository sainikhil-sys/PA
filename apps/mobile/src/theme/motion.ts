import { useReducedMotion } from "react-native-reanimated";
import { useThemePreference } from "./preference";

/** True when the phone asks for reduced motion, or the person chose "Reduce motion" in Cowork. */
export function useReduceMotion(): boolean {
  const system = useReducedMotion();
  const pref = useThemePreference((s) => s.motion);
  return system || pref === "reduce";
}
