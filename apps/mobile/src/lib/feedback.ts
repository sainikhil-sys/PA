import * as Haptics from "expo-haptics";
import { useThemePreference } from "@/theme/preference";

/**
 * Vibration feedback, in one place so Settings > Appearance > Haptics can turn it off everywhere.
 * Failures are ignored: feedback is never worth an error.
 */
export const feedback = {
  selection() {
    if (!useThemePreference.getState().haptics) return;
    void Haptics.selectionAsync().catch(() => {});
  },
  error() {
    if (!useThemePreference.getState().haptics) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  },
};
