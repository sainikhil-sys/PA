import * as Haptics from "expo-haptics";
import type { Tabs } from "expo-router";
import { Image } from "expo-image";
import { BriefcaseIcon, HouseSimpleIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMe } from "@/lib/queries";
import { color, font, motion, radius, space } from "@/theme/tokens";

/** Props Expo Router passes to a custom tab bar (its type isn't exported publicly). */
type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];

const BAR_HEIGHT = 64;
const BAR_GAP = 12;
const ITEM = 72;

/** Space to leave under scrolling content on tab screens so the floating bar never covers it. */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + BAR_GAP + Math.max(insets.bottom, space.sm) + space.lg;
}

const ICONS: Record<string, Icon> = { index: HouseSimpleIcon, workspace: BriefcaseIcon };
const LABELS: Record<string, string> = { index: "Home", workspace: "Workspace", settings: "Profile" };

/**
 * Floating tab bar: a white rounded container above the system navigation, three items, a small
 * dot under the active one that slides between them, and a light haptic tick on change.
 */
export function FloatingTabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const me = useMe();
  const pending = me.data?.pendingApprovals ?? 0;
  const routes = state.routes.filter((r) => r.name in LABELS);
  const activeKey = state.routes[state.index]?.key;
  const activeIndex = Math.max(
    0,
    routes.findIndex((r) => r.key === activeKey),
  );

  const dot = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(activeIndex * ITEM + ITEM / 2 - 3, { duration: reduceMotion ? 0 : motion.base }) }],
  }));

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: Math.max(insets.bottom, space.sm) + BAR_GAP, alignItems: "center" }}>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: "row",
          height: BAR_HEIGHT,
          paddingHorizontal: space.sm,
          borderRadius: radius.sheet + 6,
          backgroundColor: color.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: color.border,
          shadowColor: "#000",
          shadowOpacity: 0.1,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        {routes.map((route, i) => {
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
              style={({ pressed }) => ({ width: ITEM, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
            >
              {IconCmp ? (
                <IconCmp size={26} color={focused ? color.text : color.subtle} weight={focused ? "fill" : "regular"} />
              ) : (
                <ProfileMark focused={focused} name={me.data?.name ?? me.data?.email ?? ""} avatarUrl={me.data?.avatarUrl ?? null} />
              )}
              {badge ? (
                <View style={{ position: "absolute", top: 8, right: 14, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 6, backgroundColor: color.accent2, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.onAccent2 }}>{badge > 99 ? "99+" : badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
        <Animated.View pointerEvents="none" style={[{ position: "absolute", left: space.sm, bottom: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: color.text }, dot]} />
      </View>
    </View>
  );
}

/** The Profile tab: the account photo when there is one, otherwise the first initial. */
function ProfileMark({ focused, name, avatarUrl }: { focused: boolean; name: string; avatarUrl: string | null }) {
  const ring = { width: 34, height: 34, borderRadius: 17, borderWidth: focused ? 2 : 1, borderColor: focused ? color.text : color.border, overflow: "hidden" as const };
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
      <Text style={{ fontFamily: font.semibold, fontSize: 15, color: color.text }}>{initial}</Text>
    </View>
  );
}
