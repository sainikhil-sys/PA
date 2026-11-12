import * as LocalAuthentication from "expo-local-authentication";

/** What this phone offers for unlocking: fingerprint, face, either, or nothing set up. */
export type BiometricInfo = {
  /** The phone has a sensor Cowork can use. */
  hardware: boolean;
  /** At least one fingerprint or face is set up in the phone's settings. */
  enrolled: boolean;
  /** Word used in copy: "fingerprint", "face" or "fingerprint or face". */
  noun: string;
  kind: "fingerprint" | "face" | "both";
};

export async function biometricInfo(): Promise<BiometricInfo> {
  try {
    const [hardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const kind = finger && !face ? "fingerprint" : face && !finger ? "face" : "both";
    return { hardware, enrolled, kind, noun: kind === "both" ? "fingerprint or face" : kind };
  } catch {
    return { hardware: false, enrolled: false, kind: "both", noun: "fingerprint or face" };
  }
}

export type BiometricOutcome = "success" | "cancelled" | "unavailable" | "failed";

/**
 * The system prompt (BiometricPrompt on Android, LocalAuthentication on iOS). The phone's own screen
 * lock is offered as a fallback inside the prompt.
 */
export async function authenticate(promptMessage: string): Promise<BiometricOutcome> {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage,
      promptSubtitle: "Cowork",
      cancelLabel: "Use Cowork PIN",
      disableDeviceFallback: false,
      biometricsSecurityLevel: "weak",
      requireConfirmation: false,
    });
    if (r.success) return "success";
    switch (r.error) {
      case "user_cancel":
      case "system_cancel":
      case "app_cancel":
      case "user_fallback":
        return "cancelled";
      case "not_enrolled":
      case "not_available":
      case "passcode_not_set":
      case "lockout":
        return "unavailable";
      default:
        return "failed";
    }
  } catch {
    return "unavailable";
  }
}
