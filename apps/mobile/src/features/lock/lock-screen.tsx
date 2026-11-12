import { FingerprintIcon, LockSimpleIcon, ScanSmileyIcon } from "phosphor-react-native";
import * as React from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ConfirmSheet } from "@/components/sheet";
import { Txt } from "@/components/ui";
import { useSession } from "@/lib/session";
import { color, radius, space, TOUCH } from "@/theme/tokens";
import { biometricInfo, type BiometricInfo } from "./biometrics";
import { PadAction, PinPad } from "./pin-pad";
import { useLock } from "./store";
import { usePinCheck } from "./use-pin-check";

/**
 * The lock screen, in its own window (a Modal) so it also sits above any sheet that was open when
 * Cowork locked. The biometric prompt opens by itself once per lock when it is turned on and Cowork
 * is in the foreground; the PIN pad is always there.
 */
export function LockScreen({ canPrompt }: { canPrompt: boolean }) {
  const biometrics = useLock((s) => s.biometrics);
  const foreground = useLock((s) => s.foreground);
  const lockSeq = useLock((s) => s.lockSeq);
  const promptedSeq = useLock((s) => s.promptedSeq);
  const markPrompted = useLock((s) => s.markPrompted);
  const runBiometric = useLock((s) => s.biometric);
  const unlock = useLock((s) => s.unlock);
  const signOut = useSession((s) => s.signOut);
  const [info, setInfo] = React.useState<BiometricInfo | null>(null);
  const [bioNote, setBioNote] = React.useState<string | null>(null);
  const [forgot, setForgot] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const pin = usePinCheck(unlock);

  React.useEffect(() => {
    if (biometrics) void biometricInfo().then(setInfo);
  }, [biometrics]);
  const bioReady = biometrics && info !== null && info.hardware && info.enrolled;

  const promptBiometric = () =>
    runBiometric("Unlock Cowork").then((r) => {
      if (r === "success") unlock();
      else if (r === "unavailable") setBioNote("Biometric unlock is not available right now. Enter your Cowork PIN.");
      else if (r === "failed") setBioNote("That did not work. Try again or enter your Cowork PIN.");
      else setBioNote(null);
    });

  // Once per lock, after the launch animation and while Cowork is on screen.
  React.useEffect(() => {
    if (!canPrompt || !foreground || !bioReady || promptedSeq === lockSeq) return;
    markPrompted();
    void runBiometric("Unlock Cowork").then((r) => {
      if (r === "success") unlock();
      else if (r === "unavailable") setBioNote("Biometric unlock is not available right now. Enter your Cowork PIN.");
      else if (r === "failed") setBioNote("That did not work. Try again or enter your Cowork PIN.");
    });
  }, [canPrompt, foreground, bioReady, promptedSeq, lockSeq, markPrompted, runBiometric, unlock]);

  async function forgetAndSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // Sign out first: the lock stays up until the session is gone, so closing the app halfway
      // through cannot leave it open. The gate then clears the lock settings.
      await signOut({ remote: true });
      await useLock.getState().clear();
    } catch {
      setSigningOut(false);
    }
  }

  const BioIcon = info?.kind === "face" ? ScanSmileyIcon : FingerprintIcon;
  const message = pin.message ?? bioNote;

  return (
    <Modal visible transparent={false} animationType="none" onRequestClose={() => {}} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaProvider>
        <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: color.bg }} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", paddingVertical: space.xxl, paddingHorizontal: space.lg, gap: space.xxl }}>
            <View style={{ alignItems: "center", gap: space.sm }}>
              <View style={{ width: 56, height: 56, borderRadius: radius.card, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, alignItems: "center", justifyContent: "center" }}>
                <LockSimpleIcon size={26} color={color.accentText} weight="bold" />
              </View>
              <Txt variant="title" accessibilityRole="header" style={{ textAlign: "center" }}>
                Cowork is locked
              </Txt>
              <Txt variant="bodyMuted" style={{ textAlign: "center" }}>
                {bioReady ? `Use your ${info.noun} or enter your Cowork PIN.` : "Enter your Cowork PIN."}
              </Txt>
            </View>

            <PinPad
              length={pin.length}
              value={pin.value}
              onChange={pin.onChange}
              busy={pin.busy}
              disabled={pin.waiting}
              message={message}
              messageTone={pin.message ? pin.tone : "muted"}
              shake={pin.shake}
              extraKey={bioReady ? <PadAction label={`Unlock with ${info.noun}`} icon={<BioIcon size={28} color={color.accentText} />} onPress={() => void promptBiometric()} /> : null}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Forgot PIN"
              onPress={() => setForgot(true)}
              style={({ pressed }) => ({ minHeight: TOUCH, paddingHorizontal: space.lg, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
            >
              <Txt variant="label" style={{ color: color.accentText }}>
                Forgot PIN
              </Txt>
            </Pressable>
          </ScrollView>

          <ConfirmSheet
            open={forgot}
            title="Forgot your PIN?"
            body="Cowork will sign out on this phone and turn off App lock. Your data stays in your account. Sign back in with the code we email you, then set a new PIN in Settings."
            confirmLabel="Sign out"
            busy={signingOut}
            onConfirm={() => void forgetAndSignOut()}
            onClose={() => setForgot(false)}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

/** Opaque cover with the Cowork lock mark: shown while Cowork is in the app switcher or loading its lock settings. */
export function PrivacyCover() {
  return (
    <View
      accessibilityLabel="Cowork"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.bg, alignItems: "center", justifyContent: "center" }}
    >
      <View style={{ width: 56, height: 56, borderRadius: radius.card, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, alignItems: "center", justifyContent: "center" }}>
        <LockSimpleIcon size={26} color={color.accentText} weight="bold" />
      </View>
    </View>
  );
}
