import { Redirect, router } from "expo-router";
import { CompassIcon } from "phosphor-react-native";
import { View } from "react-native";
import { Button, EmptyState, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { space } from "@/theme/tokens";

/**
 * Any link the app has no screen for (an old notification, a mistyped cowork:// link). Signed out,
 * every screen except sign-in is guarded, so "/" itself lands here on launch: go straight to Welcome.
 */
export default function NotFound() {
  const signedIn = useSession((s) => s.status === "signedIn");
  if (!signedIn) return <Redirect href="/welcome" />;
  return (
    <Screen edges={["top", "bottom"]}>
      <View style={{ flex: 1, justifyContent: "center", padding: space.lg }}>
        <EmptyState
          icon={CompassIcon}
          title="This page isn't in the app"
          body="The link may be old, or it points to something only the website has."
          action={<Button label="Go to Home" variant="primary" onPress={() => router.replace("/")} />}
        />
      </View>
    </Screen>
  );
}
