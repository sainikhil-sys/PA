import { Tabs } from "expo-router";
import { FloatingTabBar } from "@/features/navigation/tab-bar";
import { color } from "@/theme/tokens";

/**
 * Five destinations on the floating bar: Home, Chat, Create, Workspace, Profile.
 * Connect takes Workspace's slot once Connect has a working feature (then Workspace's places move
 * to Home and Profile); no empty tab ships before that.
 */
export default function TabLayout() {
  return (
    <Tabs tabBar={(props) => <FloatingTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="assistant" options={{ title: "Chat" }} />
      <Tabs.Screen name="create" options={{ title: "Create" }} />
      <Tabs.Screen name="workspace" options={{ title: "Workspace" }} />
      <Tabs.Screen name="settings" options={{ title: "Profile" }} />
    </Tabs>
  );
}
