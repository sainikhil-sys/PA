import * as React from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { Easing, type SharedValue, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { color, font } from "@/theme/tokens";
import { useReduceMotion } from "@/theme/motion";

/*
 * The opening sequence, on the same timing as the Cowork showreel's closing lockup:
 *   a dot appears, rides a circle and draws the C behind it, settles in the opening and sends out a
 *   ring; the mark slides left while "Cowork" rises through its baseline, then the line beneath fades
 *   up. When the app is ready the whole view fades and eases forward into the first screen.
 * The mark is drawn on the 32-unit grid of the web mark (components/layout/mark.tsx).
 */

const U = 2; // dp per grid unit: the mark's 32-unit grid is 64dp.
const R = 10; // arc radius
const STROKE = 4.6;
const DOT = 2.6;
const MOUTH = 16 + 0.72 * R; // where the dot rests, on the C's opening
const ARC = "M23.07 8.93 A10 10 0 1 0 23.07 23.07";
const ARC_LEN = R * 1.5 * Math.PI; // 270 degrees
// The visible mark spans grid x 3.6 to 26 (arc's outer edge to the dot's edge).
const MARK_LEFT = 16 - R - STROKE / 2;
const MARK_W = (MOUTH + DOT - MARK_LEFT) * U;
const GAP = 14;
const WORD = "Cowork";
const WORD_SIZE = 46;
const WORD_LINE = 58;

// Timeline, in milliseconds.
const POP = [0, 220] as const;
const GLIDE = [160, 420] as const;
const RIDE = [420, 1020] as const;
const PULSE = [1000, 1220] as const;
const RING = [1000, 1600] as const;
const SLIDE = [1060, 1640] as const;
const LETTER_AT = 1120;
const LETTER_STEP = 45;
const LETTER_DUR = 720;
const LINE_IN = [1460, 2100] as const;
const END = 2100;
const EXIT = 340;

const ACircle = Animated.createAnimatedComponent(Circle);
const APath = Animated.createAnimatedComponent(Path);

function prog(t: number, a: number, b: number) {
  "worklet";
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}
function lerp(a: number, b: number, k: number) {
  "worklet";
  return a + (b - a) * k;
}
function smooth(x: number) {
  "worklet";
  return x * x * (3 - 2 * x);
}
function bump(x: number) {
  "worklet";
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x);
}
function outCubic(x: number) {
  "worklet";
  return 1 - (1 - x) ** 3;
}
function inOutCubic(x: number) {
  "worklet";
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}
function outExpo(x: number) {
  "worklet";
  return x >= 1 ? 1 : 1 - 2 ** (-10 * x);
}
function inOutExpo(x: number) {
  "worklet";
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2;
}
function outBack(x: number) {
  "worklet";
  const c = 1.70158;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}

/** The dot leaves the opening, rides the circle (drawing the arc from its top end) and comes back. */
function ride(phi: number) {
  "worklet";
  const q = Math.PI / 4;
  let rad = R;
  if (phi < q) rad = lerp(0.72 * R, R, smooth(phi / q));
  else if (phi > 7 * q) rad = lerp(R, 0.72 * R, smooth((phi - 7 * q) / q));
  return { x: 16 + Math.cos(-phi) * rad, y: 16 + Math.sin(-phi) * rad, arc: Math.min(1, Math.max(0, (phi - q) / (6 * q))) };
}

/** Where the dot is at time t (before the ride it pops in at the centre and glides to the opening). */
function dotAt(t: number) {
  "worklet";
  if (t < RIDE[0]) {
    const g = inOutCubic(prog(t, GLIDE[0], GLIDE[1]));
    return { x: lerp(16, MOUTH, g), y: 16, arc: 0 };
  }
  return ride(inOutCubic(prog(t, RIDE[0], RIDE[1])) * 2 * Math.PI);
}

function Mark({ t }: { t: SharedValue<number> }) {
  const arcProps = useAnimatedProps(() => {
    const a = dotAt(t.value).arc;
    return { strokeDashoffset: ARC_LEN * (1 - a), strokeOpacity: a > 0.001 ? 1 : 0 };
  });
  const dotProps = useAnimatedProps(() => {
    const p = dotAt(t.value);
    const pop = t.value >= POP[1] ? 1 : Math.max(0, outBack(prog(t.value, POP[0], POP[1])));
    return { cx: p.x, cy: p.y, r: DOT * pop * (1 + 0.3 * bump(prog(t.value, PULSE[0], PULSE[1]))) };
  });
  const ringProps = useAnimatedProps(() => {
    const s = prog(t.value, RING[0], RING[1]);
    return { r: DOT + R * 2.2 * outCubic(s), strokeOpacity: s > 0 && s < 1 ? 0.7 * (1 - s) : 0 };
  });
  return (
    // 64 grid units drawn in a 128dp box, so the ring can grow past the mark's own 64dp.
    <Svg width={64 * U} height={64 * U} viewBox="-16 -16 64 64" style={{ position: "absolute", left: -(16 + MARK_LEFT) * U, top: -16 * U }}>
      <APath d={ARC} fill="none" stroke={color.text} strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={[ARC_LEN, ARC_LEN]} animatedProps={arcProps} />
      {[3, 2, 1].map((e) => (
        <Ghost key={e} t={t} lag={e * 20} alpha={0.25 * (1 - e / 4)} />
      ))}
      <ACircle cx={MOUTH} cy={16} fill="none" stroke={color.accent} strokeWidth={0.5} animatedProps={ringProps} />
      <ACircle fill={color.accent} animatedProps={dotProps} />
    </Svg>
  );
}

/** A fading copy of the dot a few frames behind it, only while it rides. */
function Ghost({ t, lag, alpha }: { t: SharedValue<number>; lag: number; alpha: number }) {
  const props = useAnimatedProps(() => {
    const p = ride(inOutCubic(prog(t.value - lag, RIDE[0], RIDE[1])) * 2 * Math.PI);
    return { cx: p.x, cy: p.y, fillOpacity: alpha * bump(prog(t.value, RIDE[0], RIDE[1])) };
  });
  return <ACircle r={DOT} fill={color.accent} animatedProps={props} />;
}

function Letter({ t, ch, i }: { t: SharedValue<number>; ch: string; i: number }) {
  const style = useAnimatedStyle(() => {
    const a = LETTER_AT + i * LETTER_STEP;
    const u = outExpo(prog(t.value, a, a + LETTER_DUR));
    return { transform: [{ translateX: (1 - u) * -10 }, { translateY: (1 - u) * WORD_LINE }] };
  });
  return (
    <Animated.Text allowFontScaling={false} style={[{ fontFamily: font.medium, fontSize: WORD_SIZE, lineHeight: WORD_LINE, letterSpacing: -0.6, color: color.text }, style]}>
      {ch}
    </Animated.Text>
  );
}

/**
 * The launch view. It plays once each time the app opens, then hands over to the app as soon as the
 * session and settings are restored (`ready`). A tap skips to the hand-over. With reduced motion it
 * shows the finished lockup and fades straight out.
 */
export function Launch({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const reduceMotion = useReduceMotion();
  const t = useSharedValue(reduceMotion ? END : 0);
  const out = useSharedValue(0);
  const wordW = useSharedValue(0);
  const [played, setPlayed] = React.useState(false);
  const leaving = React.useRef(false);

  React.useEffect(() => {
    if (reduceMotion) {
      t.set(END);
      const id = setTimeout(() => setPlayed(true), 300);
      return () => clearTimeout(id);
    }
    t.set(withTiming(END, { duration: END, easing: Easing.linear }));
    const id = setTimeout(() => setPlayed(true), END + 120);
    return () => clearTimeout(id);
  }, [reduceMotion, t]);

  const leave = React.useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    out.set(withTiming(1, { duration: EXIT, easing: Easing.out(Easing.cubic) }));
    setTimeout(onDone, EXIT + 20);
  }, [onDone, out]);

  React.useEffect(() => {
    if (played && ready) leave();
  }, [played, ready, leave]);

  const skip = () => {
    setPlayed(true);
    if (!reduceMotion) t.set(END);
  };

  const screen = useAnimatedStyle(() => ({ opacity: 1 - out.value }));
  const lockup = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.06 * out.value }] }));
  // Alone, the mark sits in the centre; it slides left as the word comes in.
  const mark = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - inOutExpo(prog(t.value, SLIDE[0], SLIDE[1]))) * ((GAP + wordW.value) / 2) }] }));
  const line = useAnimatedStyle(() => {
    const c = outExpo(prog(t.value, LINE_IN[0], LINE_IN[1]));
    return { opacity: c, transform: [{ translateY: (1 - c) * 14 }] };
  });

  return (
    <Animated.View
      accessibilityLabel="Cowork is starting"
      accessibilityLiveRegion="polite"
      style={[{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color.bg }, screen]}
    >
      <Pressable onPress={skip} accessible={false} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Animated.View style={[{ alignItems: "center" }, lockup]}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Animated.View style={[{ width: MARK_W, height: 32 * U }, mark]}>
              <Mark t={t} />
            </Animated.View>
            <View
              onLayout={(e) => {
                wordW.set(e.nativeEvent.layout.width);
              }}
              style={{ flexDirection: "row", height: WORD_LINE, overflow: "hidden", marginLeft: GAP, marginTop: -4 }}
            >
              {WORD.split("").map((ch, i) => (
                <Letter key={i} t={t} ch={ch} i={i} />
              ))}
            </View>
          </View>
          <Animated.View style={line}>
            <Text allowFontScaling={false} style={{ fontFamily: font.display, fontSize: 17, color: color.muted, marginTop: 4 }}>
              A personal AI assistant
            </Text>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
