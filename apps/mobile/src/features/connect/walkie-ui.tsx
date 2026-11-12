import * as Haptics from "expo-haptics";
import { MicrophoneIcon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { Txt } from "@/components/ui";
import { color, motion, radius, space } from "@/theme/tokens";
import { SPEAKING_LEVEL } from "./audio-session";
import { connectAccent } from "./theme";
import { QUALITY_TEXT, type Quality } from "./walkie-logic";

/**
 * The large push-to-talk control. Hold to talk; with `latched` on, a tap starts talking and the next
 * tap stops (easier with a screen reader, or for anyone who cannot hold a press).
 */
export function TalkButton({ talking, latched, disabled, onTalk }: { talking: boolean; latched: boolean; disabled?: boolean; onTalk: (on: boolean) => void }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  React.useEffect(() => {
    scale.value = reduced ? 1 : withTiming(talking ? 0.97 : 1, { duration: motion.fast });
  }, [talking, reduced, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const set = (on: boolean) => {
    if (on) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onTalk(on);
  };

  const label = latched ? (talking ? "Talking. Tap to stop." : "Tap to talk") : talking ? "Talking. Release to stop." : "Hold to talk";
  const bg = talking ? connectAccent.live : connectAccent.main;

  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={latched ? undefined : "Press and hold to send your voice to the channel. Turn on Tap to talk in this screen if holding is hard."}
        accessibilityState={{ disabled: Boolean(disabled), selected: talking }}
        disabled={disabled}
        onPressIn={latched ? undefined : () => set(true)}
        onPressOut={latched ? undefined : () => set(false)}
        onPress={latched ? () => set(!talking) : undefined}
        style={({ pressed }) => ({
          minHeight: 168,
          borderRadius: radius.card,
          backgroundColor: bg,
          alignItems: "center",
          justifyContent: "center",
          gap: space.sm,
          opacity: disabled ? 0.5 : pressed && latched ? 0.9 : 1,
          borderWidth: 2,
          borderColor: talking ? color.text : bg,
        })}
      >
        <MicrophoneIcon size={36} color={connectAccent.onMain} weight="bold" />
        <Txt variant="heading" style={{ color: connectAccent.onMain }}>
          {label}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

/** A plain level bar (data, not decoration, so it updates even with reduced motion). */
export function LevelMeter({ level, label }: { level: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, level)) * 100);
  const speaking = level >= SPEAKING_LEVEL;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct, text: speaking ? "Speaking" : "Quiet" }}
      style={{ height: 6, borderRadius: 3, backgroundColor: color.surface3, overflow: "hidden" }}
    >
      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: speaking ? connectAccent.live : color.borderStrong }} />
    </View>
  );
}

export function QualityLabel({ quality }: { quality: Quality | undefined }) {
  const q = quality ?? "unknown";
  const tone = q === "good" ? color.success : q === "fair" ? color.warning : q === "unknown" ? color.subtle : color.danger;
  return (
    <Txt variant="small" style={{ color: tone }}>
      {QUALITY_TEXT[q]}
    </Txt>
  );
}
