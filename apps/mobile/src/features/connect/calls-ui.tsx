import { router } from "expo-router";
import { PhoneIcon } from "phosphor-react-native";
import * as React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Button, Txt } from "@/components/ui";
import { color, space } from "@/theme/tokens";
import { useAudioLevels } from "./audio-session";
import { ConnectAudio } from "./audio-native";
import { useCalls } from "./calls";
import { formatDuration, type Participant } from "./calls-logic";
import { linkForPeer, useConnect } from "./connect-store";
import { LevelMeter } from "./walkie-ui";

/**
 * A "Call" button any Connect screen can show for one person. It is disabled unless that person is
 * connected right now; calls do not use the internet, so they cannot reach someone who is not.
 */
export function CallButton({ peerKey, compact = true, style }: { peerKey: string; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const connected = useConnect((s) => Boolean(linkForPeer(s, peerKey)));
  const busy = useCalls((s) => s.busy);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void useCalls.getState().start();
  }, []);

  const available = ConnectAudio.isAvailable();
  const onPress = async () => {
    setError(null);
    const id = await useCalls.getState().startCall([peerKey]);
    if (id) router.push(`/connect/call/${id}`);
    else setError(useCalls.getState().error);
  };

  return (
    <View style={[{ gap: space.xs }, style]}>
      <Button
        label="Call"
        icon={PhoneIcon}
        compact={compact}
        disabled={!connected || !available}
        loading={busy}
        onPress={() => void onPress()}
        accessibilityLabel={connected ? "Call this person" : "Call. Not available: this person is not connected"}
      />
      {error ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

/** "4:12", ticking once a second from when the call connected. */
export function CallTimer({ since }: { since: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const text = formatDuration(now - since);
  return (
    <Txt variant="heading" accessibilityLabel={`Call time ${text}`} style={{ fontVariant: ["tabular-nums"] }}>
      {text}
    </Txt>
  );
}

const STATE_TEXT: Record<Participant["state"], string> = {
  invited: "Ringing",
  joined: "In the call",
  declined: "Declined",
  left: "Left",
  lost: "Connection lost",
  no_answer: "No answer",
};

/** One person in a call: name, state, and their live voice level. */
export function ParticipantRow({ p }: { p: Participant }) {
  const level = useAudioLevels((s) => s.levels[p.key] ?? 0);
  const detail = p.state === "joined" && !p.hasKey ? "Connecting voice" : STATE_TEXT[p.state];
  return (
    <View style={{ gap: space.xs, paddingVertical: space.sm }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
        <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
          {p.name}
        </Txt>
        <Txt variant="small">{detail}</Txt>
      </View>
      {p.state === "joined" ? <LevelMeter level={level} label={`${p.name} voice level`} /> : null}
    </View>
  );
}
