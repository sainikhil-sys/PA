import { useMutation } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { DownloadSimpleIcon } from "phosphor-react-native";
import * as React from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, Input, Screen, Txt } from "@/components/ui";
import { SubHeader } from "@/features/settings/parts";
import { api, errorText } from "@/lib/api";
import { API_URL } from "@/lib/config";
import PhoneLink from "@/lib/phone-link";
import { queryClient } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { color, radius, space } from "@/theme/tokens";

const DELETED = [
  "Your account and profile",
  "All chats and their history",
  "Memories and notes",
  "Tasks, reminders and automations",
  "Documents and everything in your knowledge base",
  "Connected services and their access tokens",
  "Linked phones and their notifications",
  "Every signed-in session, on the web and on phones",
];

/** Permanent account deletion: says exactly what goes, offers the export first, then requires typing DELETE. */
export default function DeleteAccountScreen() {
  const signOut = useSession((s) => s.signOut);
  const [typed, setTyped] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const ready = typed.trim() === "DELETE";

  const del = useMutation({
    mutationFn: () => api<{ ok: true }>("/api/mobile/me", { method: "DELETE", body: { confirm: "DELETE" } }),
    onSuccess: async () => {
      // The account is gone server-side. Forget everything this phone kept for it, without calling the
      // API again (any call would now be refused and read as an expired session).
      PhoneLink.clearLink();
      await Promise.all(["cowork.phoneDeviceId", "cowork.pushToken"].map((k) => SecureStore.deleteItemAsync(k).catch(() => {})));
      await signOut();
      queryClient.clear();
    },
    onError: () => setConfirming(false),
  });

  // A second tap before the re-render would send a second delete, which the server then refuses as signed out.
  const sentRef = React.useRef(false);
  const submit = () => {
    if (!ready || sentRef.current) return;
    sentRef.current = true;
    del.mutate(undefined, { onError: () => (sentRef.current = false) });
  };

  return (
    <Screen>
      <SubHeader title="Delete account" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.xxl }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: space.md }}>
            <Txt variant="body">Deleting your account removes all of this from Cowork. It can't be undone.</Txt>
            <View style={{ backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, padding: space.lg, gap: space.sm }}>
              {DELETED.map((d) => (
                <View key={d} style={{ flexDirection: "row", gap: space.sm }}>
                  <Txt variant="body" style={{ color: color.subtle }}>
                    •
                  </Txt>
                  <Txt variant="body" style={{ flex: 1 }}>
                    {d}
                  </Txt>
                </View>
              ))}
            </View>
            <Txt variant="small">Your Gmail and Google Calendar themselves are not changed.</Txt>
          </View>

          <View style={{ gap: space.sm }}>
            <Txt variant="heading">Keep a copy first</Txt>
            <Txt variant="bodyMuted">Download everything as JSON or Markdown from the Privacy page on the website.</Txt>
            <Button label="Export my data on the website" icon={DownloadSimpleIcon} onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/settings/privacy`)} />
          </View>

          <View style={{ gap: space.md }}>
            <Input
              label="Type DELETE to confirm"
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              placeholder="DELETE"
              editable={!del.isPending}
              error={del.isError ? errorText(del.error) : null}
            />
            <Button label="Delete my account" variant="danger" disabled={!ready || del.isPending} onPress={() => setConfirming(true)} accessibilityLabel="Delete my account permanently" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmSheet
        open={confirming}
        title="Delete your account"
        body="Your account and everything in it will be deleted now. This can't be undone."
        confirmLabel="Delete permanently"
        destructive
        busy={del.isPending}
        onConfirm={submit}
        onClose={() => !del.isPending && setConfirming(false)}
      />
    </Screen>
  );
}
