import * as Linking from "expo-linking";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { AddressBookIcon } from "phosphor-react-native";
import * as React from "react";
import { Alert, ScrollView, View } from "react-native";
import { Button, Card, EmptyState, Input, Screen, SectionHeader, Txt } from "@/components/ui";
import { fetchSharedCard, type CardFields } from "@/features/connect/social-api";
import { useReceivedCards, type ReceivedCard } from "@/features/connect/social-cards";
import { SubHeader } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

function CardView({ c, footer }: { c: CardFields; footer?: React.ReactNode }) {
  const lines: [string, string, (() => void) | null][] = [
    ["Email", c.email, c.email ? () => void Linking.openURL(`mailto:${c.email}`) : null],
    ["Phone", c.phone, c.phone ? () => void Linking.openURL(`tel:${c.phone.replace(/[^+0-9]/g, "")}`) : null],
    ["Website", c.website, c.website ? () => void Linking.openURL(c.website) : null],
  ];
  return (
    <Card style={{ gap: space.sm }}>
      <Txt variant="heading">{c.displayName}</Txt>
      {c.headline || c.organization ? <Txt variant="bodyMuted">{[c.headline, c.organization].filter(Boolean).join(", ")}</Txt> : null}
      {lines
        .filter(([, v]) => v)
        .map(([label, v, open]) => (
          <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Txt variant="small" style={{ width: 64 }}>
              {label}
            </Txt>
            <Txt selectable style={{ flex: 1 }}>
              {v}
            </Txt>
            {open ? <Button label="Open" variant="ghost" compact onPress={open} /> : null}
          </View>
        ))}
      {c.note ? <Txt variant="small">{c.note}</Txt> : null}
      {footer}
    </Card>
  );
}

const clean = (raw: string) => raw.trim().toUpperCase().replace(/[\s-]/g, "");

/** Cards you received, kept only on this phone. Also opens a card someone shared by link or code. */
export default function ReceivedCardsScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const s = useReceivedCards();
  const [code, setCode] = React.useState(params.code?.toUpperCase() ?? "");
  // Opened from a shared link (cowork://connect/social/cards?code=...) looks the card up at once.
  const [lookup, setLookup] = React.useState<string | null>(params.code ? clean(params.code) : null);
  const [kept, setKept] = React.useState<string | null>(null);
  const shared = useQuery({ queryKey: ["connect", "shared-card", lookup], queryFn: () => fetchSharedCard(lookup!), enabled: Boolean(lookup), retry: false });
  const found = lookup && shared.data && kept !== lookup ? { ...shared.data, code: lookup } : null;

  React.useEffect(() => {
    void s.load();
    s.clearLast();
    // load and clearLast are stable store actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = (c: ReceivedCard) =>
    Alert.alert("Delete this card?", "It is removed from this phone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void s.remove(c.id) },
    ]);

  return (
    <Screen>
      <SubHeader title="Cards you received" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}>
        <View style={{ gap: space.sm }}>
          <Input label="Open a shared card" value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="Card code" autoCapitalize="characters" autoCorrect={false} maxLength={14} />
          <Button label="Look up" loading={shared.isFetching} disabled={clean(code).length < 12} onPress={() => {
              setKept(null);
              if (lookup === clean(code)) void shared.refetch();
              else setLookup(clean(code));
            }}
          />
          {shared.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(shared.error)}</Txt> : null}
          {found ? (
            <CardView
              c={found.card}
              footer={
                found.mine ? (
                  <Txt variant="small">This is your own card.</Txt>
                ) : (
                  <Button
                    label="Keep on this phone"
                    variant="primary"
                    compact
                    onPress={async () => {
                      await s.save(found.card, `link:${found.code}`, "link");
                      setKept(found.code);
                      setCode("");
                    }}
                  />
                )
              }
            />
          ) : null}
        </View>

        <View style={{ gap: space.sm }}>
          <SectionHeader title="Saved on this phone" />
          {s.cards.length ? (
            s.cards.map((c) => (
              <CardView
                key={c.id}
                c={c}
                footer={
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Txt variant="small">
                      {c.via === "nearby" ? "Received nearby" : "Opened from a link"} · {new Date(c.receivedAt).toLocaleDateString()}
                    </Txt>
                    <Button label="Delete" variant="ghost" compact onPress={() => remove(c)} />
                  </View>
                }
              />
            ))
          ) : (
            <EmptyState icon={AddressBookIcon} title="No cards yet" body="Cards people send you nearby, or that you keep from a link, appear here. They stay on this phone." />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
