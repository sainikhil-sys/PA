import { CheckIcon, FingerprintIcon, LockSimpleIcon, PasswordIcon, ScanSmileyIcon, EyeSlashIcon } from "phosphor-react-native";
import * as React from "react";
import { BackHandler, Platform, Pressable, ScrollView, Switch, View } from "react-native";
import { Button, Row, Screen, Txt } from "@/components/ui";
import { biometricInfo, type BiometricInfo } from "@/features/lock/biometrics";
import { POLICIES, type PinLength } from "@/features/lock/logic";
import { PadAction, PinPad } from "@/features/lock/pin-pad";
import { useLock } from "@/features/lock/store";
import { usePinCheck } from "@/features/lock/use-pin-check";
import { ListSection, SubHeader } from "@/features/settings/parts";
import { color, radius, space, TOUCH } from "@/theme/tokens";
import { feedback } from "@/lib/feedback";

/** Turning the lock on, changing the PIN, or turning it off. */
type Flow = "setup" | "change" | "off";
type Step = "verify" | "length" | "new" | "confirm" | "saving" | "biometric";

/** Settings > App lock: a Cowork PIN, optional fingerprint or face, and when the lock comes back. */
export default function AppLockScreen() {
  const enabled = useLock((s) => s.enabled);
  const pinLength = useLock((s) => s.pinLength);
  const biometrics = useLock((s) => s.biometrics);
  const policy = useLock((s) => s.policy);
  const hideInRecents = useLock((s) => s.hideInRecents);
  const setPolicy = useLock((s) => s.setPolicy);
  const setBiometrics = useLock((s) => s.setBiometrics);
  const setHideInRecents = useLock((s) => s.setHideInRecents);
  const runBiometric = useLock((s) => s.biometric);
  const [info, setInfo] = React.useState<BiometricInfo | null>(null);
  const [flow, setFlow] = React.useState<Flow | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [bioBusy, setBioBusy] = React.useState(false);

  React.useEffect(() => {
    void biometricInfo().then(setInfo);
  }, []);

  const noun = info?.noun ?? "fingerprint or face";
  const BioIcon = info?.kind === "face" ? ScanSmileyIcon : FingerprintIcon;

  async function toggleBiometrics(next: boolean) {
    setNote(null);
    if (!next) {
      await setBiometrics(false).catch(() => setNote("Cowork could not save that change. Try again."));
      return;
    }
    setBioBusy(true);
    try {
      const r = await runBiometric(`Use your ${noun} to unlock Cowork`);
      if (r === "success") {
        await setBiometrics(true);
        setNote(`Cowork now unlocks with your ${noun}. Your PIN still works.`);
      } else if (r === "unavailable") {
        setNote(`Your ${noun} is not available right now. Check your phone's security settings, then try again.`);
      }
    } catch {
      setNote("Cowork could not save that change. Try again.");
    } finally {
      setBioBusy(false);
    }
  }

  if (flow) {
    return (
      <PinFlow
        flow={flow}
        info={info}
        onDone={(text) => {
          setFlow(null);
          setNote(text);
        }}
      />
    );
  }

  const sw = (value: boolean, onChange: (v: boolean) => void, label: string, disabled?: boolean) => (
    <Switch
      accessibilityLabel={label}
      accessibilityRole="switch"
      value={value}
      disabled={disabled}
      onValueChange={onChange}
      trackColor={{ false: color.surface3, true: color.accent }}
      thumbColor={value ? color.bg : color.muted}
    />
  );

  const policySection = (
    <View accessibilityRole="radiogroup" accessibilityLabel="When to lock">
      <ListSection title="Lock Cowork">
        {POLICIES.map((o) => {
          const selected = o.value === policy;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${o.label}. ${o.detail}`}
              onPress={() => {
                if (selected) return;
                feedback.selection();
                void setPolicy(o.value).catch(() => setNote("Cowork could not save that change. Try again."));
              }}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH + space.md, paddingHorizontal: space.lg, backgroundColor: pressed ? color.surface2 : "transparent" })}
            >
              <View style={{ flex: 1, paddingVertical: space.sm }}>
                <Txt variant="label">{o.label}</Txt>
                <Txt variant="small">{o.detail}</Txt>
              </View>
              {selected ? <CheckIcon size={20} color={color.accentText} weight="bold" /> : null}
            </Pressable>
          );
        })}
      </ListSection>
      <Txt variant="small" style={{ paddingHorizontal: space.lg, marginTop: space.sm }}>
        Cowork always locks when it starts fresh, for example after a restart or after you close it from recent apps.
      </Txt>
    </View>
  );

  return (
    <Screen>
      <SubHeader title="App lock" />
      <ScrollView contentContainerStyle={{ paddingTop: space.xl, paddingBottom: space.xxxl, gap: space.xxl }}>
        {enabled ? (
          <>
            <ListSection title="App lock">
              <Row icon={LockSimpleIcon} title="App lock" detail="On. Cowork asks for your PIN to open." right={sw(true, () => setFlow("off"), "App lock")} />
              {info?.hardware ? (
                <Row
                  icon={BioIcon}
                  title={`Unlock with ${noun}`}
                  detail={info.enrolled ? null : `No ${noun} is set up on this phone. Add one in your phone's settings to use it here.`}
                  right={sw(biometrics && info.enrolled, (v) => void toggleBiometrics(v), `Unlock with ${noun}`, bioBusy || !info.enrolled)}
                />
              ) : null}
              <Row icon={PasswordIcon} title="Change PIN" detail={`Your PIN has ${pinLength} digits. You can switch between 4 and 6 here.`} onPress={() => setFlow("change")} />
            </ListSection>
            {policySection}
          </>
        ) : (
          <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
            <View style={{ gap: space.sm }}>
              <Txt variant="heading">Keep Cowork private on this phone</Txt>
              <Txt variant="bodyMuted">
                With App lock on, Cowork asks for a PIN when it opens. You can also unlock it with your fingerprint or face if your phone has one set up.
              </Txt>
            </View>
            <Button label="Turn on App lock" variant="primary" icon={LockSimpleIcon} onPress={() => setFlow("setup")} />
          </View>
        )}

        {note ? (
          <Txt variant="small" accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg, color: color.text }}>
            {note}
          </Txt>
        ) : null}

        {Platform.OS === "android" ? (
          <ListSection title="Privacy">
            <Row
              icon={EyeSlashIcon}
              title="Hide Cowork in recent apps and block screenshots"
              detail="Recent apps shows a blank card for Cowork, and screenshots and screen recordings of Cowork are blocked."
              right={sw(hideInRecents, (v) => void setHideInRecents(v).catch(() => setNote("Cowork could not save that change. Try again.")), "Hide Cowork in recent apps and block screenshots")}
            />
          </ListSection>
        ) : null}

        {enabled ? (
          <Txt variant="small" style={{ paddingHorizontal: space.lg }}>
            If you forget your PIN, tap Forgot PIN on the lock screen. Cowork signs out on this phone and turns off App lock. Sign back in with the code we email you, then set a new PIN.
          </Txt>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const FLOW_TITLE: Record<Flow, string> = { setup: "Turn on App lock", change: "Change PIN", off: "Turn off App lock" };

/** The PIN steps for one flow: check the current PIN, pick a length, enter and repeat the new PIN. */
function PinFlow({ flow, info, onDone }: { flow: Flow; info: BiometricInfo | null; onDone: (note: string | null) => void }) {
  const currentLength = useLock((s) => s.pinLength);
  const biometricsOn = useLock((s) => s.biometrics);
  const setPin = useLock((s) => s.setPin);
  const setBiometrics = useLock((s) => s.setBiometrics);
  const clear = useLock((s) => s.clear);
  const runBiometric = useLock((s) => s.biometric);
  const [step, setStep] = React.useState<Step>(flow === "setup" ? "length" : "verify");
  const [length, setLength] = React.useState<PinLength>(flow === "setup" ? 4 : currentLength);
  const [first, setFirst] = React.useState("");
  const [entry, setEntry] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [shake, setShake] = React.useState(0);
  const [bioNote, setBioNote] = React.useState<string | null>(null);

  const cancel = () => onDone(null);
  // Android back leaves the flow (not the screen); it waits while a new PIN is being saved.
  React.useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (step !== "saving") onDone(null);
      return true;
    });
    return () => sub.remove();
  }, [onDone, step]);

  async function verified() {
    if (flow === "off") {
      try {
        await clear();
        onDone("App lock is off. Cowork opens without a PIN.");
      } catch {
        setError("Cowork could not turn off App lock. Try again.");
      }
      return;
    }
    setStep("length");
  }
  const check = usePinCheck(() => void verified());
  const bioReady = biometricsOn && info !== null && info.hardware && info.enrolled;

  async function verifyWithBiometric() {
    setBioNote(null);
    const r = await runBiometric("Confirm it is you");
    if (r === "success") void verified();
    else if (r === "unavailable" || r === "failed") setBioNote("That did not work. Enter your Cowork PIN.");
  }

  function fail(text: string) {
    setError(text);
    setShake((n) => n + 1);
    feedback.error();
  }

  function onNew(next: string) {
    setError(null);
    setEntry(next);
    if (next.length < length) return;
    setFirst(next);
    setEntry("");
    setStep("confirm");
  }

  function onConfirm(next: string) {
    setError(null);
    setEntry(next);
    if (next.length < length) return;
    setEntry("");
    if (next !== first) {
      setFirst("");
      setStep("new");
      fail("The two PINs did not match. Enter a new PIN again.");
      return;
    }
    setStep("saving");
    void setPin(next, length)
      .then(() => {
        if (flow === "setup" && info?.hardware && info.enrolled) setStep("biometric");
        else onDone(flow === "setup" ? "App lock is on. Cowork will ask for your PIN when it opens." : "Your new PIN is saved.");
      })
      .catch(() => {
        setStep("new");
        fail("Cowork could not save your PIN. Try again.");
      });
  }

  async function enableBiometric() {
    const r = await runBiometric(`Use your ${info?.noun ?? "fingerprint or face"} to unlock Cowork`);
    if (r === "success") {
      await setBiometrics(true).catch(() => {});
      onDone(`App lock is on. Cowork unlocks with your ${info?.noun ?? "fingerprint or face"} or your PIN.`);
    } else if (r !== "cancelled") {
      setBioNote("That did not work. You can turn it on later on this screen.");
    }
  }

  const BioIcon = info?.kind === "face" ? ScanSmileyIcon : FingerprintIcon;
  let heading = "";
  let body = "";
  let content: React.ReactNode = null;

  if (step === "verify") {
    heading = "Enter your current PIN";
    body = bioReady ? `Or use your ${info.noun}.` : flow === "off" ? "This confirms it is you before App lock turns off." : "This confirms it is you before you choose a new PIN.";
    content = (
      <PinPad
        length={check.length}
        value={check.value}
        onChange={check.onChange}
        busy={check.busy}
        disabled={check.waiting}
        message={check.message ?? error ?? bioNote}
        messageTone={check.message || error ? "danger" : "muted"}
        shake={check.shake}
        extraKey={bioReady ? <PadAction label={`Confirm with ${info.noun}`} icon={<BioIcon size={28} color={color.accentText} />} onPress={() => void verifyWithBiometric()} /> : null}
      />
    );
  } else if (step === "length") {
    heading = "Choose a PIN length";
    body = "A 6 digit PIN is harder to guess.";
    content = (
      <View style={{ alignSelf: "stretch", gap: space.lg }}>
        <View accessibilityRole="radiogroup" accessibilityLabel="PIN length" style={{ gap: space.sm }}>
          {([4, 6] as const).map((n) => {
            const selected = n === length;
            return (
              <Pressable
                key={n}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${n} digits`}
                onPress={() => setLength(n)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: TOUCH + space.sm,
                  paddingHorizontal: space.lg,
                  borderRadius: radius.control,
                  borderWidth: 1,
                  borderColor: selected ? color.accent : color.border,
                  backgroundColor: pressed ? color.surface2 : color.surface,
                })}
              >
                <Txt variant="label" style={{ flex: 1 }}>
                  {n} digits
                </Txt>
                {selected ? <CheckIcon size={20} color={color.accentText} weight="bold" /> : null}
              </Pressable>
            );
          })}
        </View>
        <Button label="Continue" variant="primary" onPress={() => setStep("new")} />
      </View>
    );
  } else if (step === "new" || step === "confirm" || step === "saving") {
    heading = step === "new" ? `Enter a new ${length} digit PIN` : "Enter the same PIN again";
    body = step === "new" ? "Avoid a PIN that is easy to guess, like 1234 or your birthday." : "This makes sure you typed it the way you meant.";
    content = (
      <PinPad
        length={length}
        value={entry}
        onChange={step === "new" ? onNew : onConfirm}
        busy={step === "saving"}
        message={error}
        messageTone="danger"
        shake={shake}
      />
    );
  } else {
    heading = `Unlock with your ${info?.noun ?? "fingerprint or face"} too?`;
    body = "Your PIN always works as well. You can change this later on this screen.";
    content = (
      <View style={{ alignSelf: "stretch", gap: space.sm }}>
        {bioNote ? (
          <Txt variant="small" accessibilityLiveRegion="polite" style={{ textAlign: "center" }}>
            {bioNote}
          </Txt>
        ) : null}
        <Button label={`Use ${info?.noun ?? "fingerprint or face"}`} variant="primary" icon={BioIcon} onPress={() => void enableBiometric()} />
        <Button label="Not now" variant="ghost" onPress={() => onDone("App lock is on. Cowork will ask for your PIN when it opens.")} />
      </View>
    );
  }

  const canCancel = step !== "saving" && step !== "biometric";
  return (
    <Screen edges={["top", "bottom"]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, minHeight: TOUCH + space.sm }}>
        <Txt variant="heading" accessibilityRole="header">
          {FLOW_TITLE[flow]}
        </Txt>
        {canCancel ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={cancel} style={({ pressed }) => ({ minHeight: TOUCH, minWidth: TOUCH, justifyContent: "center", alignItems: "flex-end", opacity: pressed ? 0.6 : 1 })}>
            <Txt variant="label" style={{ color: color.accentText }}>
              Cancel
            </Txt>
          </Pressable>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg, paddingVertical: space.xxl, gap: space.xxl }}>
        <View style={{ alignItems: "center", gap: space.sm, alignSelf: "stretch" }}>
          <Txt variant="title" style={{ textAlign: "center" }}>
            {heading}
          </Txt>
          <Txt variant="bodyMuted" style={{ textAlign: "center" }}>
            {body}
          </Txt>
        </View>
        {content}
      </ScrollView>
    </Screen>
  );
}
