import * as Haptics from "expo-haptics";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { Image } from "expo-image";
import type { Tabs } from "expo-router";
import { BriefcaseIcon, ChatCircleIcon, HouseSimpleIcon, PlusSquareIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { AccessibilityInfo, Keyboard, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMe } from "@/lib/queries";
import { color, currentScheme, font, motion, radius, space } from "@/theme/tokens";

/** Props Expo Router passes to a custom tab bar (its type isn't exported publicly). */
type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];

const BAR_HEIGHT = 64;
const BAR_GAP = 12;
const BAR_PAD = space.sm;
const INDICATOR = 18;
const BAR_RADIUS = radius.sheet + 6;

/** Space to leave under scrolling content on tab screens so the floating bar never covers it. */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + BAR_GAP + Math.max(insets.bottom, space.sm) + space.lg;
}

const ICONS: Record<string, Icon> = { index: HouseSimpleIcon, assistant: ChatCircleIcon, create: PlusSquareIcon, workspace: BriefcaseIcon };
const LABELS: Record<string, string> = { index: "Home", assistant: "Chat", create: "Create", workspace: "Workspace", settings: "Profile" };

/** Item width: fills the bar on narrow phones (at least 56) and stops growing at 72. */
function itemWidth(screen: number, count: number) {
  return Math.max(56, Math.min(72, Math.floor((screen - space.lg * 2 - BAR_PAD * 2) / count)));
}

/** iOS can turn transparency down in accessibility settings; respect it. */
function useReduceTransparency() {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    if (Platform.OS !== "ios") return;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(setReduce);
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/** The bar steps aside while the keyboard is open, so it never sits on top of an input. */
function useKeyboardOpen() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setOpen(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

/**
 * Floating, translucent tab bar. On iOS with Liquid Glass it is a system glass surface; elsewhere
 * (Android, older iOS, reduced transparency) a translucent page-coloured material with a hairline
 * border, a light top edge and a soft shadow. No blur on Android: it costs frame time on every
 * scroll. An orange indicator slides to the active item and a light haptic tick confirms a change.
 */
export function FloatingTabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const reduceTransparency = useReduceTransparency();
  const keyboardOpen = useKeyboardOpen();
  const me = useMe();
  const pending = me.data?.pendingApprovals ?? 0;
  const routes = state.routes.filter((r) => r.name in LABELS);
  const activeKey = state.routes[state.index]?.key;
  const activeIndex = Math.max(
    0,
    routes.findIndex((r) => r.key === activeKey),
  );
  const item = itemWidth(screen, routes.length);

  const indicator = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(activeIndex * item + (item - INDICATOR) / 2, { duration: reduceMotion ? 0 : motion.base }) }],
  }));

  if (keyboardOpen) return null;

  const glass = Platform.OS === "ios" && !reduceTransparency && isLiquidGlassAvailable();

  const items = (
    <>
      {routes.map((route) => {
        const focused = route.key === activeKey;
        const label = LABELS[route.name]!;
        const IconCmp = ICONS[route.name];
        const onPress = () => {
          const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            void Haptics.selectionAsync().catch(() => {});
            navigateToTab(route.key);
          }
        };
        const badge = route.name === "workspace" && pending > 0 ? pending : 0;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={badge ? `${label}, ${badge} waiting for approval` : label}
            onPress={onPress}
            onLongPress={() => emitter.emit({ type: "tabLongPress", target: route.key })}
            style={({ pressed }) => ({ width: item, alignItems: "center", justifyContent: "center", gap: 3, opacity: pressed ? 0.7 : 1 })}
          >
            {IconCmp ? (
              <IconCmp size={24} color={focused ? color.text : color.subtle} weight={focused ? "fill" : "regular"} />
            ) : (
              <ProfileMark focused={focused} name={me.data?.name ?? me.data?.email ?? ""} avatarUrl={me.data?.avatarUrl ?? null} />
            )}
            <Text style={{ fontFamily: focused ? font.semibold : font.medium, fontSize: 11, lineHeight: 14, color: focused ? color.text : color.subtle }} maxFontSizeMultiplier={1.2} numberOfLines={1}>
              {label}
            </Text>
            {badge ? (
              <View style={{ position: "absolute", top: 6, right: item / 2 - 22, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 6, backgroundColor: color.accent2, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.onAccent2 }}>{badge > 99 ? "99+" : badge}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: BAR_PAD, top: 0, width: INDICATOR, height: 3, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: color.accent }, indicator]} />
    </>
  );

  const row = { flexDirection: "row" as const, height: BAR_HEIGHT, paddingHorizontal: BAR_PAD };

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: Math.max(insets.bottom, space.sm) + BAR_GAP, alignItems: "center" }}>
      {glass ? (
        <GlassView accessibilityRole="tablist" glassEffectStyle="regular" colorScheme={currentScheme()} style={[row, { borderRadius: BAR_RADIUS, overflow: "hidden" }]}>
          {items}
        </GlassView>
      ) : (
        <View
          accessibilityRole="tablist"
          style={[
            row,
            {
              borderRadius: BAR_RADIUS,
              backgroundColor: reduceTransparency ? color.bg : color.glass,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: color.border,
              shadowColor: color.shadow,
              shadowOpacity: currentScheme() === "light" ? 0.12 : 0.5,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 8 },
              elevation: 10,
            },
          ]}
        >
          {/* Light top edge: the material catching light. */}
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: space.xl, right: space.xl, height: StyleSheet.hairlineWidth, backgroundColor: color.glassEdge }} />
          {items}
        </View>
      )}
    </View>
  );
}

/** The Profile tab: the account photo when there is one, otherwise the first initial. */
function ProfileMark({ focused, name, avatarUrl }: { focused: boolean; name: string; avatarUrl: string | null }) {
  const ring = { width: 26, height: 26, borderRadius: 13, borderWidth: focused ? 2 : 1, borderColor: focused ? color.text : color.border, overflow: "hidden" as const };
  if (avatarUrl) {
    return (
      <View style={ring}>
        <Image source={{ uri: avatarUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" accessibilityIgnoresInvertColors />
      </View>
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "C";
  return (
    <View style={[ring, { alignItems: "center", justifyContent: "center", backgroundColor: color.surface2 }]}>
      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: color.text }}>{initial}</Text>
    </View>
  );
}
