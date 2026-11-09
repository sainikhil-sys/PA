import { setChatIntent } from "@/lib/intent";
import { router } from "expo-router";
import { ArrowRightIcon, PaperPlaneRightIcon } from "phosphor-react-native";
import * as React from "react";
import { View } from "react-native";
import { Button, Card, Input, Skeleton, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useSuggestions } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { AuthFrame, Heading, StepIndicator, useStepGuard } from "@/features/onboarding/frame";
import { color, space } from "@/theme/tokens";

/** Used when suggestions can't be loaded or there are fewer than 3; each is something Cowork can actually do. */
const FALLBACK = [
  "What's on my calendar this week?",
  "Summarize the important emails from today.",
  "Remind me tomorrow at 9am to follow up on invoices.",
  "Draft a reply to my most recent email.",
];

/** Setup step 4: start the first conversation from a suggestion or your own words. */
export default function FirstChat() {
  const setOnboarding = useSession((s) => s.setOnboarding);
  const suggestions = useSuggestions();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const inflight = React.useRef(false);
  const redirecting = useStepGuard("first-chat");

  const prompts = React.useMemo(() => {
    const fromServer = (suggestions.data ?? []).map((p) => p.trim()).filter(Boolean);
    const list = fromServer.length >= 3 ? fromServer : [...fromServer, ...FALLBACK.filter((f) => !fromServer.includes(f))];
    return list.slice(0, 4);
  }, [suggestions.data]);

  const finish = async (prompt?: string) => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    // Marks setup finished on the server too, so the website doesn't ask again. Not critical.
    await api("/api/mobile/me", { method: "PATCH", body: { onboarded: true } }).catch(() => {});
    await setOnboarding("done").catch(() => {});
    const value = prompt?.trim();
    // Home goes underneath, so Back from the first chat lands on Home instead of leaving the app.
    router.replace("/");
    if (value) {
      setChatIntent({ send: value });
      router.push("/chat/new");
    }
  };

  const typed = text.trim();

  if (redirecting) return null;

  return (
    <AuthFrame
      footer={
        <>
          <Button label="Ask Cowork" variant="primary" icon={PaperPlaneRightIcon} loading={busy && typed.length > 0} disabled={!typed || busy} onPress={() => void finish(typed)} />
          <Button label="Skip for now" variant="ghost" disabled={busy} onPress={() => void finish()} />
        </>
      }
    >
      <StepIndicator step="first-chat" />
      <Heading title="Ask your first question" body="Pick a suggestion or write your own. Cowork will show you what it prepares before anything is sent." />
      <View style={{ gap: space.sm }}>
        {suggestions.isPending ? (
          <Skeleton rows={4} height={56} />
        ) : (
          prompts.map((p) => (
            <Card key={p} onPress={busy ? undefined : () => void finish(p)} accessibilityLabel={`Ask: ${p}`} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingVertical: space.md }}>
              <Txt variant="body" style={{ flex: 1 }}>
                {p}
              </Txt>
              <ArrowRightIcon size={18} color={color.muted} />
            </Card>
          ))
        )}
      </View>
      <Input
        label="Or ask in your own words"
        value={text}
        onChangeText={setText}
        placeholder="Ask Cowork anything"
        multiline
        maxLength={8000}
        editable={!busy}
        style={{ minHeight: 88, paddingTop: space.md, textAlignVertical: "top" }}
      />
    </AuthFrame>
  );
}
