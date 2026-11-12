import { router, useLocalSearchParams } from "expo-router";
import { MicrophoneIcon, MicrophoneSlashIcon, PhoneDisconnectIcon, PhoneIcon, SpeakerHighIcon, SpeakerLowIcon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Button, Card, Screen, Txt } from "@/components/ui";
import { useCalls } from "@/features/connect/calls";
import { callTitle, ENDED_LINGER_MS, endText, type Call } from "@/features/connect/calls-logic";
import { CallTimer, ParticipantRow } from "@/features/connect/calls-ui";
import { connectAccent } from "@/features/connect/theme";
import { useWalkie } from "@/features/connect/walkie";
import { Group } from "@/features/settings/parts";
import { color, radius, space, TOUCH } from "@/theme/tokens";

function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/connect/calls");
}

/** A large labelled square control for the call screen (rounded rectangle, 64dp). */
function Control({ icon: IconCmp, label, onPress, active, danger, disabled }: { icon: typeof PhoneIcon; label: string; onPress: () => void; active?: boolean; danger?: boolean; disabled?: boolean }) {
  const bg = danger ? color.danger : active ? connectAccent.main : color.surface2;
  const fg = danger ? color.bg : active ? connectAccent.onMain : color.text;
  return (
    <View style={{ alignItems: "center", gap: space.xs, minWidth: 80 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: Boolean(active), disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          width: TOUCH + 16,
          height: TOUCH + 16,
          borderRadius: radius.card,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: danger ? color.danger : active ? connectAccent.main : color.borderStrong,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        })}
      >
        <IconCmp size={26} color={fg} weight={active || danger ? "bold" : "regular"} />
      </Pressable>
      <Txt variant="small" style={{ textAlign: "center" }}>
        {label}
      </Txt>
    </View>
  );
}

/** A quiet ring around the caller's initial while a call rings. Still with reduced motion on. */
function RingMark({ name }: { name: string }) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  React.useEffect(() => {
    cancelAnimation(pulse);
    if (reduced) {
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [reduced, pulse]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.25 + pulse.value * 0.4, transform: [{ scale: 1 + pulse.value * 0.08 }] }));
  return (
    <View style={{ width: 132, height: 132, alignItems: "center", justifyContent: "center" }} importantForAccessibility="no-hide-descendants">
      <Animated.View style={[{ position: "absolute", width: 132, height: 132, borderRadius: 66, borderWidth: 2, borderColor: connectAccent.live }, ring]} />
      <View style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: color.surface3, alignItems: "center", justifyContent: "center" }}>
        <Txt variant="display">{(name.trim()[0] ?? "?").toUpperCase()}</Txt>
      </View>
    </View>
  );
}

function phaseText(c: Call): string {
  switch (c.phase) {
    case "incoming":
      return c.participants.length > 1 ? `Incoming group call, ${c.participants.length + 1} people` : "Incoming Connect call";
    case "ringing":
      return "Ringing";
    case "connecting":
      return "Connecting voice";
    case "active":
      return "Connected, encrypted between phones";
    case "ended":
      return endText(c.endReason);
  }
}

function Incoming({ c }: { c: Call }) {
  const calls = useCalls();
  const inWalkie = useWalkie((s) => Boolean(s.joined));
  const caller = c.participants.find((p) => p.key === c.host);
  return (
    <View style={{ flex: 1, justifyContent: "space-between", padding: space.xl }}>
      <View style={{ alignItems: "center", gap: space.lg, marginTop: space.xxxl }}>
        <RingMark name={caller?.name ?? "?"} />
        <Txt variant="title" style={{ textAlign: "center" }} accessibilityRole="header">
          {caller?.name ?? "Someone"}
        </Txt>
        <Txt variant="bodyMuted" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
          {phaseText(c)}
        </Txt>
        {c.participants.length > 1 ? (
          <Txt variant="small" style={{ textAlign: "center" }}>
            With {c.participants.filter((p) => p.key !== c.host).map((p) => p.name).join(", ")}
          </Txt>
        ) : null}
        <Txt variant="small" style={{ textAlign: "center", maxWidth: 300 }}>
          Over your direct connection, no internet used.{inWalkie ? " Answering leaves your Walkie channel." : ""}
        </Txt>
        {calls.error ? (
          <Txt variant="small" style={{ color: color.danger, textAlign: "center" }} accessibilityLiveRegion="assertive">
            {calls.error}
          </Txt>
        ) : null}
      </View>
      <View style={{ gap: space.md }}>
        <Button label="Accept" variant="primary" icon={PhoneIcon} loading={calls.busy} onPress={() => void calls.answer()} accessibilityLabel={`Accept call from ${caller?.name ?? "this person"}`} />
        <Button label="Decline" variant="danger" icon={PhoneDisconnectIcon} disabled={calls.busy} onPress={calls.decline} />
      </View>
    </View>
  );
}

function InCall({ c }: { c: Call }) {
  const calls = useCalls();
  const ended = c.phase === "ended";
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl }}>
        <View style={{ alignItems: "center", gap: space.sm, marginTop: space.xl }}>
          {c.phase === "ringing" ? <RingMark name={c.participants[0]?.name ?? "?"} /> : null}
          <Txt variant="title" style={{ textAlign: "center" }} accessibilityRole="header">
            {callTitle(c.participants)}
          </Txt>
          <Txt variant="bodyMuted" style={{ textAlign: "center", color: ended ? color.muted : c.phase === "active" ? color.success : color.muted }} accessibilityLiveRegion="polite">
            {phaseText(c)}
          </Txt>
          {c.connectedAt !== null && !ended ? <CallTimer since={c.connectedAt} /> : null}
        </View>

        {c.participants.length > 1 || c.phase === "connecting" ? (
          <Group style={{ paddingHorizontal: space.lg }}>
            {c.participants.map((p) => (
              <ParticipantRow key={p.key} p={p} />
            ))}
          </Group>
        ) : null}

        {calls.error ? (
          <Card style={{ borderColor: color.danger }}>
            <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="assertive">
              {calls.error}
            </Txt>
          </Card>
        ) : null}
        {c.participants.length > 1 && !ended ? (
          <Txt variant="small" style={{ textAlign: "center" }}>
            You hear the people whose phones are connected to yours.
          </Txt>
        ) : null}
      </ScrollView>

      <View style={{ padding: space.xl, gap: space.xl, borderTopWidth: 1, borderTopColor: color.border }}>
        {ended ? (
          <Button label="Close" onPress={close} />
        ) : (
          <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
            <Control icon={calls.muted ? MicrophoneSlashIcon : MicrophoneIcon} label={calls.muted ? "Unmute" : "Mute"} active={calls.muted} onPress={calls.toggleMute} />
            <Control icon={calls.speaker ? SpeakerHighIcon : SpeakerLowIcon} label={calls.speaker ? "Speaker on" : "Speaker off"} active={calls.speaker} onPress={calls.toggleSpeaker} />
            <Control icon={PhoneDisconnectIcon} label="End call" danger onPress={calls.hangup} />
          </View>
        )}
      </View>
    </View>
  );
}

/** One call: incoming (full screen Accept or Decline), ringing, in progress, or just ended. */
export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const call = useCalls((s) => (s.call && s.call.id === id ? s.call : null));
  const dismiss = useCalls((s) => s.dismiss);

  React.useEffect(() => {
    void useCalls.getState().start();
  }, []);

  // An ended call stays briefly so the person sees how it ended, then the screen closes.
  const ended = call?.phase === "ended";
  React.useEffect(() => {
    if (!ended) return;
    const t = setTimeout(() => {
      dismiss(id);
      close();
    }, ENDED_LINGER_MS);
    return () => clearTimeout(t);
  }, [ended, id, dismiss]);

  React.useEffect(() => () => dismiss(id), [id, dismiss]);

  return (
    <Screen edges={["top", "bottom"]}>
      {!call ? (
        <View style={{ flex: 1, justifyContent: "center", padding: space.xl, gap: space.lg }}>
          <Txt variant="heading" style={{ textAlign: "center" }}>
            This call has ended.
          </Txt>
          <Button label="Close" onPress={close} />
        </View>
      ) : call.phase === "incoming" ? (
        <Incoming c={call} />
      ) : (
        <InCall c={call} />
      )}
    </Screen>
  );
}
