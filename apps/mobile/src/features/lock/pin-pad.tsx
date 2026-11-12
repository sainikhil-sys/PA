import { BackspaceIcon } from "phosphor-react-native";
import * as React from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { Txt } from "@/components/ui";
import { color, font, radius, space, TOUCH } from "@/theme/tokens";
import { useReduceMotion } from "@/theme/motion";

const KEY_W = 76;
const KEY_H = 60;
const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
];

/**
 * Number pad and entry dots for a Cowork PIN. Keys are at least 48dp, each has a spoken label, and
 * the dots announce how many digits are in. `shake` changes on a wrong PIN (skipped with reduced motion).
 */
export function PinPad({
  length,
  value,
  onChange,
  disabled,
  busy,
  message,
  messageTone = "muted",
  shake = 0,
  extraKey,
}: {
  length: number;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  busy?: boolean;
  message?: string | null;
  messageTone?: "muted" | "danger";
  shake?: number;
  /** Bottom-left key, for example the biometric button. */
  extraKey?: React.ReactNode;
}) {
  const reduced = useReduceMotion();
  const x = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  React.useEffect(() => {
    if (shake === 0 || reduced) return;
    x.set(withSequence(withTiming(-10, { duration: 50 }), withTiming(10, { duration: 70 }), withTiming(-6, { duration: 60 }), withTiming(0, { duration: 50 })));
  }, [shake, reduced, x]);

  // Android reads the dots through their live region; iOS needs an explicit announcement.
  React.useEffect(() => {
    if (Platform.OS === "ios" && value.length > 0) AccessibilityInfo.announceForAccessibility(`${value.length} of ${length} digits entered`);
  }, [value.length, length]);

  const off = disabled || busy;
  const press = (d: string) => {
    if (off || value.length >= length) return;
    onChange(value + d);
  };
  const del = () => {
    if (off || value.length === 0) return;
    onChange(value.slice(0, -1));
  };

  return (
    <View style={{ alignItems: "center", gap: space.xl }}>
      <Animated.View
        accessible
        accessibilityLabel={`${value.length} of ${length} digits entered`}
        accessibilityLiveRegion="polite"
        style={[{ flexDirection: "row", gap: space.lg, height: 24, alignItems: "center" }, shakeStyle]}
      >
        {Array.from({ length }, (_, i) => {
          const filled = i < value.length;
          return (
            <View
              key={i}
              style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: filled ? color.accent : color.borderStrong, backgroundColor: filled ? color.accent : "transparent" }}
            />
          );
        })}
      </Animated.View>

      <View style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: space.lg }}>
        {busy ? (
          <ActivityIndicator color={color.accentText} accessibilityLabel="Checking" />
        ) : message ? (
          <Txt variant="small" accessibilityLiveRegion="polite" style={{ textAlign: "center", color: messageTone === "danger" ? color.danger : color.muted }}>
            {message}
          </Txt>
        ) : null}
      </View>

      <View style={{ gap: space.md }}>
        {ROWS.map((row) => (
          <View key={row[0]} style={{ flexDirection: "row", gap: space.lg }}>
            {row.map((d) => (
              <Key key={d} label={d} onPress={() => press(d)} disabled={off} />
            ))}
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: space.lg }}>
          <View style={{ width: KEY_W, height: KEY_H, alignItems: "center", justifyContent: "center" }}>{extraKey}</View>
          <Key label="0" onPress={() => press("0")} disabled={off} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete last digit"
            accessibilityState={{ disabled: Boolean(off) || value.length === 0 }}
            disabled={off || value.length === 0}
            onPress={del}
            style={({ pressed }) => ({ width: KEY_W, height: KEY_H, alignItems: "center", justifyContent: "center", borderRadius: radius.card, opacity: value.length === 0 ? 0.35 : pressed ? 0.6 : 1 })}
          >
            <BackspaceIcon size={26} color={color.text} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Key({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: KEY_W,
        height: KEY_H,
        minHeight: TOUCH,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: color.border,
        backgroundColor: pressed ? color.surface2 : color.surface,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={{ fontFamily: font.medium, fontSize: 26, color: color.text }} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A square key for the pad's bottom-left slot (same size as the digits). */
export function PadAction({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ width: KEY_W, height: KEY_H, alignItems: "center", justifyContent: "center", borderRadius: radius.card, opacity: pressed ? 0.6 : 1 })}
    >
      {icon}
    </Pressable>
  );
}
