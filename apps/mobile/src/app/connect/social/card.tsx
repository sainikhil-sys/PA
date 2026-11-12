import * as Linking from "expo-linking";
import { router } from "expo-router";
import { PaperPlaneRightIcon, ShareNetworkIcon } from "phosphor-react-native";
import * as React from "react";
import { Alert, ScrollView, Share, Switch, View } from "react-native";
import { Button, Input, Row, Screen, SectionHeader, Txt } from "@/components/ui";
import { useConnect } from "@/features/connect/connect-store";
import { useMyCard, useSaveCard, type CardFields, type MyCard } from "@/features/connect/social-api";
import { shareCardWith } from "@/features/connect/social-cards";
import { Loaded } from "@/features/connect/social-ui";
import { connectAccent } from "@/features/connect/theme";
import { Group, SubHeader } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

const EMPTY: CardFields = { displayName: "", headline: "", organization: "", email: "", phone: "", website: "", note: "" };

/** Your digital business card: only what you type here is on it. */
export default function CardScreen() {
  const q = useMyCard();
  return (
    <Screen>
      <SubHeader title="Business card" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}>
        <Loaded q={q}>{(d) => <CardForm initial={d.card} suggestedName={d.suggestedName} />}</Loaded>
      </ScrollView>
    </Screen>
  );
}

/** Starts from the saved card once; after that the form owns the text until it is saved. */
function CardForm({ initial, suggestedName }: { initial: MyCard | null; suggestedName: string }) {
  const q = useMyCard();
  const save = useSaveCard();
  const links = useConnect((s) => s.links);
  const connected = Object.values(links).filter((l) => l.phase === "secure" && l.peerKey);
  const [f, setF] = React.useState<CardFields>(() =>
    initial
      ? { displayName: initial.displayName, headline: initial.headline, organization: initial.organization, email: initial.email, phone: initial.phone, website: initial.website, note: initial.note }
      : { ...EMPTY, displayName: suggestedName },
  );
  const [shareEnabled, setShareEnabled] = React.useState(initial?.shareEnabled ?? false);
  const [sentTo, setSentTo] = React.useState<Record<string, "sent" | "failed">>({});

  const card = q.data?.card ?? initial;
  const set = (k: keyof CardFields) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const persist = (extra: { newShareCode?: boolean } = {}) => save.mutate({ ...f, shareEnabled, ...extra });
  const link = card ? Linking.createURL("/connect/social/cards", { queryParams: { code: card.shareCode } }) : null;

  return (
            <>
              <Txt variant="bodyMuted">Fill in only what you want people to have. Only what you save here is on the card.</Txt>
              <Input label="Name" value={f.displayName} onChangeText={set("displayName")} maxLength={80} />
              <Input label="Role or headline" value={f.headline} onChangeText={set("headline")} maxLength={120} />
              <Input label="Organisation or school" value={f.organization} onChangeText={set("organization")} maxLength={120} />
              <Input label="Email" value={f.email} onChangeText={set("email")} maxLength={254} keyboardType="email-address" autoCapitalize="none" />
              <Input label="Phone" value={f.phone} onChangeText={set("phone")} maxLength={32} keyboardType="phone-pad" />
              <Input label="Website" value={f.website} onChangeText={set("website")} maxLength={300} autoCapitalize="none" keyboardType="url" placeholder="https://" />
              <Input label="Note" value={f.note} onChangeText={set("note")} maxLength={300} multiline />
              <Group>
                <Row
                  title="Share by link"
                  detail={shareEnabled ? "On. Anyone signed in to Cowork with your link or code can see this card." : "Off. Only people you send it to nearby get it."}
                  right={<Switch value={shareEnabled} onValueChange={setShareEnabled} trackColor={{ true: connectAccent.main, false: color.surface3 }} thumbColor={color.text} accessibilityLabel="Share by link" />}
                />
              </Group>
              {save.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(save.error)}</Txt> : null}
              <Button label="Save card" variant="primary" disabled={!f.displayName.trim()} loading={save.isPending} onPress={() => persist()} />

              {card?.shareEnabled && link ? (
                <View style={{ gap: space.sm }}>
                  <SectionHeader title="Link" />
                  <Txt variant="small" selectable>
                    Code {card.shareCode}. The link opens in the Cowork app; people without Cowork cannot open it.
                  </Txt>
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    <Button label="Share link" icon={ShareNetworkIcon} compact style={{ flex: 1 }} onPress={() => void Share.share({ message: `My Cowork card: ${link} (code ${card.shareCode})` })} />
                    <Button
                      label="New link"
                      variant="ghost"
                      compact
                      style={{ flex: 1 }}
                      onPress={() =>
                        Alert.alert("Make a new link?", "The old link and code stop working.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "New link", onPress: () => persist({ newShareCode: true }) },
                        ])
                      }
                    />
                  </View>
                </View>
              ) : null}

              <View style={{ gap: space.sm }}>
                <SectionHeader title="Send nearby, without internet" />
                {connected.length ? (
                  <Group>
                    {connected.map((l) => (
                      <Row
                        key={l.link}
                        icon={PaperPlaneRightIcon}
                        title={l.name}
                        detail={sentTo[l.peerKey!] === "sent" ? "Card sent" : sentTo[l.peerKey!] === "failed" ? "Not sent. They may have disconnected." : "Tap to send the card on screen now"}
                        onPress={() => setSentTo((x) => ({ ...x, [l.peerKey!]: shareCardWith(l.peerKey!, f) ? "sent" : "failed" }))}
                      />
                    ))}
                  </Group>
                ) : (
                  <Txt variant="small">Nobody is connected right now. Connect with someone on the Connect screen, then come back here.</Txt>
                )}
                <Txt variant="small">Sends the card as it is on screen, encrypted, to that person only. It does not need to be saved first.</Txt>
                <Button label="Open Connect" variant="ghost" onPress={() => router.push("/connect")} />
              </View>
            </>
  );
}
