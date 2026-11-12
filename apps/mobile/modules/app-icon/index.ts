import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type Native = {
  getIcon(keys: string[]): string | null;
  setIcon(key: string, keys: string[]): string | null;
};

// Null on iOS, web and builds without the native module (for example Expo Go).
const native: Native | null = Platform.OS === "android" ? requireOptionalNativeModule<Native>("AppIcon") : null;

/**
 * Launcher icon variants. Every call is a safe no-op (or null) where the native module or the
 * icon aliases are missing, so the screen can say so instead of pretending.
 */
const AppIcon = {
  /** The variant the launcher shows now, read back from Android; null when switching isn't supported. */
  current(keys: readonly string[]): string | null {
    try {
      return native?.getIcon([...keys]) ?? null;
    } catch {
      return null;
    }
  },
  /** Switches the launcher icon. Returns the variant Android reports as enabled afterwards. */
  set(key: string, keys: readonly string[]): string | null {
    if (!native) return null;
    return native.setIcon(key, [...keys]);
  },
};

export default AppIcon;
