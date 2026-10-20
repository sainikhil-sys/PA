import { router } from "expo-router";
import { BellIcon, CheckCircleIcon, DeviceMobileIcon, MicrophoneIcon } from "phosphor-react-native";
import * as React from "react";
import { View } from "react-native";
import { Button, Txt } from "@/components/ui";
import { enablePush, pushEnabled } from "@/lib/push";
import { useSession } from "@/lib/session";
import { AuthFrame, Heading, InfoItem, StepIndicator, useStepGuard } from "@/features/onboarding/frame";
import { color, space } from "@/theme/tokens";

type PushState = { kind: "idle" } | { kind: "busy" } | { kind: "on" } | { kind: "failed"; message: string };

/** Setup step 3: each permission, why it helps, and that it's only asked for when needed. */
export default function Permissions() {
  const setOnboarding = useSession((s) => s.setOnboarding);
  const [push, setPush] = React.useState<PushState>({ kind: "idle" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inflight = React.useRef(false);
  const redirecting = useStepGuard("permissions");

  React.useEffect(() => {
    let alive = true;
    void pushEnabled()
      .then((on) => {
        if (alive && on) setPush({ kind: "on" });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const turnOn = async () => {
    if (push.kind === "busy" || push.kind === "on") return;
    setPush({ kind: "busy" });
    try {
      const res = await enablePush();
      setPush(res.ok ? { kind: "on" } : { kind: "failed", message: res.message });
    } catch {
      setPush({ kind: "failed", message: "Couldn't turn on notifications. You can try again later in Settings." });
    }
  };

  const next = async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      await setOnboarding("first-chat");
      router.replace("/onboarding/first-chat");
    } catch {
      inflight.current = false;
      setError("Couldn't save your progress on this phone. Try again.");
      setBusy(false);
    }
  };

  if (redirecting) return null;

  return (
    <AuthFrame footer={<Button label="Continue" variant="primary" loading={busy} disabled={push.kind === "busy"} onPress={() => void next()} />}>
      <StepIndicator step="permissions" />
      <Heading title="Permissions" body="Cowork asks for each permission only when a feature needs it. Everything is optional, and you can change it later." />
      <View style={{ gap: space.xl }}>
        <InfoItem icon={BellIcon} title="Notifications" body="Get a notification when a reminder is due, an urgent email arrives or an automation finishes.">
          <View style={{ marginTop: space.sm, gap: space.sm }}>
            {push.kind === "on" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 40 }} accessibilityLiveRegion="polite">
                <CheckCircleIcon size={18} color={color.success} weight="fill" />
                <Txt variant="label">Notifications are on</Txt>
              </View>
            ) : (
              <Button
                label={push.kind === "failed" ? "Try again" : "Turn on"}
                compact
                loading={push.kind === "busy"}
                onPress={() => void turnOn()}
                accessibilityLabel={push.kind === "failed" ? "Try turning on notifications again" : "Turn on notifications"}
                style={{ alignSelf: "flex-start", minHeight: 48 }}
              />
            )}
            {push.kind === "failed" ? (
              <Txt variant="small" style={{ color: color.warning }} accessibilityLiveRegion="polite">
                {push.message}
              </Txt>
            ) : null}
          </View>
        </InfoItem>
        <InfoItem
          icon={MicrophoneIcon}
          title="Microphone"
          body="Asked the first time you tap to talk to Cowork. Text chat always works without it."
        />
        <InfoItem
          icon={DeviceMobileIcon}
          title="Phone link (optional)"
          body="Lets Cowork see this phone's notifications, only after you allow it in Android settings. Set it up later in Settings > Phone link."
        />
      </View>
      {error ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
    </AuthFrame>
  );
}
