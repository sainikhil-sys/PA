import { Tabs } from "expo-router";
import { FloatingTabBar } from "@/features/navigation/tab-bar";
import { color } from "@/theme/tokens";

/** Three destinations on a floating bar: Home, Workspace, Profile. Chats and Create open from Home. */
export default function TabLayout() {
  return (
    <Tabs tabBar={(props) => <FloatingTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="workspace" options={{ title: "Workspace" }} />
      <Tabs.Screen name="settings" options={{ title: "Profile" }} />
    </Tabs>
  );
}
