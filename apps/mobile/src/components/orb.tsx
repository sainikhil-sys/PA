import * as React from "react";
import { Pressable, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { color } from "@/theme/tokens";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const LABEL: Record<OrbState, string> = {
  idle: "Talk to your agent",
  listening: "Listening. Tap to stop.",
  thinking: "Thinking",
  speaking: "Speaking. Tap to stop.",
};

/**
 * The agent's voice orb: a warm radial gradient that breathes slowly when idle and swells while
 * listening. With reduced motion on, it stays still and only its label changes.
 */
export function Orb({ size = 168, state = "idle", onPress }: { size?: number; state?: OrbState; onPress?: () => void }) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);

  React.useEffect(() => {
    cancelAnimation(pulse);
    if (reduced) {
      pulse.value = 0;
      return;
    }
    const duration = state === "listening" ? 900 : state === "thinking" ? 1400 : state === "speaking" ? 700 : 3200;
    pulse.value = withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [state, reduced, pulse]);

  const amp = state === "idle" ? 0.03 : state === "thinking" ? 0.04 : 0.08;
  const core = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * amp }] }));
  const halo = useAnimatedStyle(() => ({ opacity: 0.28 + pulse.value * (state === "idle" ? 0.1 : 0.32), transform: [{ scale: 1.12 + pulse.value * amp * 2 }] }));

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={LABEL[state]} onPress={onPress} hitSlop={12} style={{ width: size * 1.3, height: size * 1.3, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={[{ position: "absolute", width: size, height: size }, halo]} pointerEvents="none">
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0.55" stopColor={color.orange} stopOpacity="0.55" />
              <Stop offset="1" stopColor={color.orangeDeep} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#halo)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[{ width: size * 0.78, height: size * 0.78 }, core]} pointerEvents="none">
        <Svg width="100%" height="100%" viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id="core" cx="38%" cy="32%" r="75%">
              <Stop offset="0" stopColor={color.warm} />
              <Stop offset="0.45" stopColor={color.orange} />
              <Stop offset="1" stopColor={color.orangeDeep} />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="50" r="50" fill="url(#core)" />
        </Svg>
      </Animated.View>
      <View pointerEvents="none" style={{ position: "absolute", width: size * 0.78, height: size * 0.78, borderRadius: size, borderWidth: 1, borderColor: "rgba(233,188,141,0.35)" }} />
    </Pressable>
  );
}
