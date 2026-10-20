import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type Native = {
  isAccessGranted(): boolean;
  openAccessSettings(): void;
  setLink(serverUrl: string, deviceToken: string): void;
  clearLink(): void;
  isLinked(): boolean;
};

// Null on iOS, web and Android builds that do not include the native module (e.g. Expo Go).
const native: Native | null = Platform.OS === "android" ? requireOptionalNativeModule<Native>("PhoneLink") : null;

/**
 * Phone link: forwards this Android phone's notifications to Cowork once Notification access is on.
 * Every call is a safe no-op (or false) where the native module is unavailable.
 */
const PhoneLink = {
  /** True only on an Android build that includes the native module. */
  isAvailable(): boolean {
    return native != null;
  },
  /** Whether the person has turned on Notification access for Cowork. */
  isAccessGranted(): boolean {
    return native?.isAccessGranted() ?? false;
  },
  /** Opens the system Notification access screen. */
  openAccessSettings(): void {
    native?.openAccessSettings();
  },
  /** Stores the server URL and this phone's device token (from POST /api/mobile/phone). Throws on an invalid URL or token. */
  setLink(serverUrl: string, deviceToken: string): void {
    native?.setLink(serverUrl, deviceToken);
  },
  /** Forgets the link: forwarding stops at once. */
  clearLink(): void {
    native?.clearLink();
  },
  /** Whether a device link is stored on this phone. */
  isLinked(): boolean {
    return native?.isLinked() ?? false;
  },
};

export default PhoneLink;
