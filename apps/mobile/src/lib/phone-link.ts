import PhoneLinkModule from "../../modules/phone-link";

/**
 * Typed wrapper over the Phone link native module (the Android notification listener). Every call is
 * guarded, so the app keeps working in a build without the module: it then reports "not available".
 */
type Native = {
  isAvailable(): boolean;
  isAccessGranted(): boolean;
  openAccessSettings(): void;
  setLink(serverUrl: string, deviceToken: string): void;
  clearLink(): void;
  isLinked(): boolean;
};

const native = (PhoneLinkModule ?? null) as Partial<Native> | null;

function isAvailable(): boolean {
  try {
    return Boolean(native?.isAvailable?.());
  } catch {
    return false;
  }
}

function guarded<T>(fn: (n: Native) => T, fallback: T): T {
  if (!isAvailable()) return fallback;
  try {
    return fn(native as Native);
  } catch {
    return fallback;
  }
}

const PhoneLink = {
  isAvailable,
  isAccessGranted: (): boolean => guarded((n) => n.isAccessGranted(), false),
  openAccessSettings: (): void => guarded((n) => n.openAccessSettings(), undefined),
  /** Throws when the module rejects the URL or token, so the caller can report it; a no-op without the module. */
  setLink: (serverUrl: string, deviceToken: string): void => {
    if (isAvailable()) (native as Native).setLink(serverUrl, deviceToken);
  },
  clearLink: (): void => guarded((n) => n.clearLink(), undefined),
  isLinked: (): boolean => guarded((n) => n.isLinked(), false),
};

export default PhoneLink;
