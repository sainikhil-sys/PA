import { router } from "expo-router";
import { BrainIcon, ChatCircleTextIcon, ExportIcon, HandPalmIcon, PlugsConnectedIcon } from "phosphor-react-native";
import * as React from "react";
import { View } from "react-native";
import { Button, Txt } from "@/components/ui";
import { useSession } from "@/lib/session";
import { AuthFrame, Heading, InfoItem, StepIndicator, useStepGuard } from "@/features/onboarding/frame";
import { color, space } from "@/theme/tokens";

/** Setup step 2: what Cowork keeps, what it can touch, and how to take it all back. */
export default function Privacy() {
  const setOnboarding = useSession((s) => s.setOnboarding);
  const [busy, setBusy] = React.useState(false);
  const inflight = React.useRef(false);
  const redirecting = useStepGuard("privacy");
  const [error, setError] = React.useState<string | null>(null);

  const next = async () => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      await setOnboarding("permissions");
      router.replace("/onboarding/permissions");
    } catch {
      inflight.current = false;
      setError("Couldn't save your progress on this phone. Try again.");
      setBusy(false);
    }
  };

  if (redirecting) return null;

  return (
    <AuthFrame footer={<Button label="Continue" variant="primary" loading={busy} onPress={() => void next()} />}>
      <StepIndicator step="privacy" />
      <Heading title="Memory and privacy" body="Here is what Cowork keeps and what it can do with your accounts." />
      <View style={{ gap: space.xl }}>
        <InfoItem icon={ChatCircleTextIcon} title="Chats are saved to your account" body="Your conversations are kept so you can come back to them on this phone or the website." />
        <InfoItem
          icon={BrainIcon}
          title="A short list of memories"
          body="Cowork keeps a few notes about you, like preferences you mention. You can see, edit and delete each one in Settings > Memory."
        />
        <InfoItem
          icon={PlugsConnectedIcon}
          title="Connected services are read-only"
          body="When you connect Gmail or Calendar, Cowork can read them. The one thing it can create is a Gmail draft, which stays in your drafts until you send it."
        />
        <InfoItem icon={HandPalmIcon} title="You approve what it prepares" body="When the agent prepares a task, draft or reminder in chat, nothing is created until you tap Approve. Automations you set up on the website run on their own schedule." />
        <InfoItem
          icon={ExportIcon}
          title="Your data stays yours"
          body="You can export everything from the website, and delete your account and all of its data on the website or in Settings > Delete account."
        />
      </View>
      {error ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
    </AuthFrame>
  );
}
