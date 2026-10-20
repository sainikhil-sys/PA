import { Tabs } from "expo-router";
import type { ColorValue } from "react-native";
import { ChatCircleIcon, CheckSquareIcon, GearSixIcon, SunHorizonIcon, type Icon } from "phosphor-react-native";
import { useMe } from "@/lib/queries";
import { color, font } from "@/theme/tokens";

function tabIcon(IconCmp: Icon) {
  return function TabIcon({ color: c, focused }: { color: ColorValue; focused: boolean }) {
    return <IconCmp size={24} color={typeof c === "string" ? c : color.text} weight={focused ? "fill" : "regular"} />;
  };
}

/** Four destinations: Home, Assistant, Tasks, Settings. */
export default function TabLayout() {
  const me = useMe();
  const pending = me.data?.pendingApprovals ?? 0;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.text,
        tabBarInactiveTintColor: color.subtle,
        tabBarStyle: { backgroundColor: color.bg, borderTopColor: color.border, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
        sceneStyle: { backgroundColor: color.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon(SunHorizonIcon), tabBarBadge: pending > 0 ? pending : undefined, tabBarBadgeStyle: { backgroundColor: color.orange, color: color.onOrange, fontFamily: font.semibold } }} />
      <Tabs.Screen name="assistant" options={{ title: "Assistant", tabBarIcon: tabIcon(ChatCircleIcon) }} />
      <Tabs.Screen name="tasks" options={{ title: "Tasks", tabBarIcon: tabIcon(CheckSquareIcon) }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: tabIcon(GearSixIcon) }} />
    </Tabs>
  );
}
