import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { EnvelopeSimpleIcon, InfoIcon } from "phosphor-react-native";
import { Pressable, View } from "react-native";
import { Orb } from "@/components/orb";
import { Button, Card, Txt } from "@/components/ui";
import { PRIVACY_URL, TERMS_URL } from "@/lib/config";
import { useSession } from "@/lib/session";
import { AuthFrame } from "@/features/onboarding/frame";
import { color, space, TOUCH } from "@/theme/tokens";

function LegalLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => void WebBrowser.openBrowserAsync(url).catch(() => {})}
      style={{ minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.sm }}
    >
      <Txt variant="small" style={{ textDecorationLine: "underline" }}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** First screen when signed out: what Cowork is, and the way in. */
export default function Welcome() {
  const expired = useSession((s) => s.expired);

  return (
    <AuthFrame
      footer={
        <>
          <Button label="Continue with email" variant="primary" icon={EnvelopeSimpleIcon} onPress={() => router.push("/sign-in")} />
          <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center" }}>
            <LegalLink label="Privacy policy" url={PRIVACY_URL} />
            <Txt variant="small" importantForAccessibility="no">
              ·
            </Txt>
            <LegalLink label="Terms" url={TERMS_URL} />
          </View>
        </>
      }
    >
      {expired ? (
        <Card style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
          <InfoIcon size={20} color={color.warm} />
          <Txt variant="small" style={{ flex: 1, color: color.text }} accessibilityLiveRegion="polite">
            Your session ended. Sign in again to pick up where you left off.
          </Txt>
        </Card>
      ) : null}
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: space.xl }}>
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Orb size={150} state="idle" />
        </View>
        <View style={{ gap: space.md, alignItems: "center" }}>
          <Txt variant="display" accessibilityRole="header">
            Cowork
          </Txt>
          <Txt variant="bodyMuted" style={{ textAlign: "center", maxWidth: 320 }}>
            A personal assistant for your inbox, calendar and tasks. It prepares the work, then asks before it acts.
          </Txt>
        </View>
      </View>
    </AuthFrame>
  );
}
