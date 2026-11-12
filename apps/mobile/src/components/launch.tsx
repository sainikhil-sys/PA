import * as React from "react";
import { Text, View } from "react-native";
import Animated, { Easing, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { color, font, space } from "@/theme/tokens";

const TRACK = 140;
const THUMB = 36;

/**
 * Launch view, shown over the app only while it restores your session and settings (no added delay):
 * the wordmark, a tagline, a thin progress bar and a short line at the bottom. Fades out when ready.
 */
export function Launch() {
  const reduceMotion = useReducedMotion();
  const x = useSharedValue(0);
  React.useEffect(() => {
    if (reduceMotion) return;
    x.value = withRepeat(withTiming(TRACK - THUMB, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [reduceMotion, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <Animated.View
      exiting={reduceMotion ? undefined : FadeOut.duration(220)}
      accessibilityLabel="Cowork is starting"
      accessibilityLiveRegion="polite"
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color.bg, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ fontFamily: font.semibold, fontSize: 44, letterSpacing: -1.2, color: color.text }} maxFontSizeMultiplier={1.2}>
        cowork
      </Text>
      <Text style={{ fontFamily: font.medium, fontSize: 15, color: color.muted, marginTop: space.md }} maxFontSizeMultiplier={1.3}>
        Your day. One assistant.
      </Text>
      <View style={{ position: "absolute", bottom: 160, width: TRACK, height: 4, borderRadius: 2, backgroundColor: color.surface3, overflow: "hidden" }}>
        <Animated.View style={[{ width: THUMB, height: 4, borderRadius: 2, backgroundColor: color.text }, thumb]} />
      </View>
      <Text style={{ position: "absolute", bottom: 64, fontFamily: font.regular, fontSize: 13, color: color.subtle }} maxFontSizeMultiplier={1.3}>
        Your mail, calendar and tasks in one place
      </Text>
    </Animated.View>
  );
}
