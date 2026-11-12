import { Tabs } from "expo-router";
import { FloatingTabBar } from "@/features/navigation/tab-bar";
import { BirthdateGate } from "@/features/onboarding/birthdate";
import { useOutboxRunner } from "@/features/social/outbox";
import { useMe } from "@/lib/queries";
import { color } from "@/theme/tokens";

/**
 * Five destinations on the floating bar: Home, Chats (people), Assistant (AI), Workspace, Profile.
 * Chats and Assistant never share a screen or a list: Chats is person-to-person messaging,
 * Assistant is the AI and its conversation history. Community takes Workspace's slot once it has
 * a working feature (then Workspace's places move to Home and Profile); no empty tab ships before that.
 */
export default function TabLayout() {
  // Unsent Chats messages keep retrying while the app is open, whichever screen is showing.
  useOutboxRunner();
  const me = useMe();
  // 13+: the app is held until the date of birth is given (only when the server asks for it).
  if (me.data?.birthDateSet === false) return <BirthdateGate />;
  return (
    <Tabs tabBar={(props) => <FloatingTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="chats" options={{ title: "Chats" }} />
      <Tabs.Screen name="assistant" options={{ title: "Assistant" }} />
      <Tabs.Screen name="workspace" options={{ title: "Workspace" }} />
      <Tabs.Screen name="settings" options={{ title: "Profile" }} />
    </Tabs>
  );
}
