import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import {
  ApertureIcon,
  BroadcastIcon,
  ChatsCircleIcon,
  CheckCircleIcon,
  CirclesThreeIcon,
  LinkBreakIcon,
  PhoneIcon,
  ProhibitIcon,
  RadioIcon,
  TrayArrowDownIcon,
  UserCircleIcon,
  UsersThreeIcon,
  WifiSlashIcon,
} from "phosphor-react-native";
import * as React from "react";
import { ScrollView, Switch, View } from "react-native";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, Card, EmptyState, Input, Row, Screen, SectionHeader, Txt } from "@/components/ui";
import { linkForPeer, useConnect, VISIBLE_FOR_MS, type LinkInfo } from "@/features/connect/connect-store";
import { useFiles } from "@/features/connect/files";
import { useGroups } from "@/features/connect/groups";
import { fingerprint } from "@/features/connect/identity";
import { Group, SubHeader } from "@/features/settings/parts";
import { useMe } from "@/lib/queries";
import { connectAccent } from "@/features/connect/theme";
import { color, space } from "@/theme/tokens";
import { useConnectSocialAvailable } from "@/features/connect/availability";

const CONSENT_KEY = "cowork.connect.consent";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Everything else Connect does, with what is waiting for this person. */
function Features() {
  const socialAvailable = useConnectSocialAvailable();
  const waitingFiles = useFiles((f) => f.transfers.filter((t) => !t.outgoing && t.status === "incoming").length);
  const invites = useGroups((g) => g.groups.filter((x) => x.myState === "invited").length);
  return (
    <View>
      <SectionHeader title="More with people nearby" />
      <Group>
        <Row icon={ApertureIcon} title="SnapShare" detail="Take a photo and send it to people connected now" onPress={() => router.push("/connect/snapshare")} />
        <Row
          icon={TrayArrowDownIcon}
          title="Transfers"
          detail={waitingFiles ? `${plural(waitingFiles, "file", "files")} waiting for you to accept` : "Files you sent and received"}
          onPress={() => router.push("/connect/transfers")}
        />
        <Row
          icon={UsersThreeIcon}
          title="Groups"
          detail={invites ? `${plural(invites, "invite", "invites")} waiting` : "Message several people at once"}
          onPress={() => router.push("/connect/groups")}
        />
        <Row icon={RadioIcon} title="Walkie" detail="Push to talk with a channel of people nearby" onPress={() => router.push("/connect/walkie")} />
        <Row icon={PhoneIcon} title="Calls" detail="Voice calls without internet, and your call history" onPress={() => router.push("/connect/calls")} />
        {/* Online part: shown only once its server routes answer (see features/connect/availability.ts). */}
        {socialAvailable ? <Row icon={CirclesThreeIcon} title="Circles and social" detail="Cards, circles, communities and events" onPress={() => router.push("/connect/social")} /> : null}
      </Group>
    </View>
  );
}

function minutesLeft(until: number | null) {
  if (!until) return null;
  return Math.max(1, Math.ceil((until - Date.now()) / 60_000));
}

function LinkCard({ l }: { l: LinkInfo }) {
  const approve = useConnect((s) => s.approve);
  const decline = useConnect((s) => s.decline);
  if (l.phase === "approve") {
    return (
      <Card style={{ gap: space.md }}>
        <Txt variant="heading">{l.name} wants to connect</Txt>
        {l.verifier ? (
          <Txt variant="small">
            Both phones show the code {l.verifier}. Accept only if theirs matches and you know who this is.
          </Txt>
        ) : null}
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Accept" variant="primary" compact onPress={() => void approve(l.link)} style={{ flex: 1 }} />
          <Button label="Decline" compact onPress={() => void decline(l.link)} style={{ flex: 1 }} />
        </View>
      </Card>
    );
  }
  const label =
    l.phase === "requesting"
      ? `Asking ${l.name} to connect${l.verifier ? `. Code: ${l.verifier}` : ""}`
      : l.phase === "securing"
        ? `Securing the connection with ${l.name}`
        : l.phase === "failed"
          ? (l.reason ?? `Could not connect to ${l.name}.`)
          : `Connected to ${l.name}`;
  return (
    <Card>
      <Txt variant="small" style={l.phase === "failed" ? { color: color.danger } : undefined}>
        {label}
      </Txt>
    </Card>
  );
}

/** Cowork Connect: chat with people nearby without internet (Android to Android, this phase). */
export default function ConnectScreen() {
  const me = useMe();
  const s = useConnect();
  const [, tick] = React.useReducer((x: number) => x + 1, 0);
  const [consentOpen, setConsentOpen] = React.useState(false);
  const [nameOpen, setNameOpen] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState("");
  const [disconnectOpen, setDisconnectOpen] = React.useState(false);

  React.useEffect(() => {
    void s.init(me.data?.name ?? "");
    // init is stable; run once the profile name is known (it is only a fallback display name).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data?.name]);

  // Refresh the "turns off in" countdown.
  React.useEffect(() => {
    if (!s.visible) return;
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [s.visible]);

  const toggle = async (on: boolean) => {
    if (!on) return s.goHidden();
    if (!(await SecureStore.getItemAsync(CONSENT_KEY))) return setConsentOpen(true);
    await s.goVisible();
  };

  const links = Object.values(s.links).filter((l) => l.phase !== "secure");
  const connected = Object.values(s.links).filter((l) => l.phase === "secure").length;
  const nearby = Object.entries(s.nearby).filter(([link]) => !s.links[link]);
  const minutes = minutesLeft(s.visibleUntil);

  return (
    <Screen>
      <SubHeader title="Connect" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }}>
        <Txt variant="bodyMuted">
          Talk to people near you with no internet, over Bluetooth and Wi-Fi. Messages are encrypted end to end and stay on your phones.
        </Txt>

        {!s.ready ? null : !s.available ? (
          <EmptyState icon={WifiSlashIcon} title="Not available on this phone" body="This build of Cowork cannot use Bluetooth or Wi-Fi to reach phones nearby." />
        ) : (
          <>
            <View>
              <SectionHeader title="This phone" />
              <Group>
                <Row
                  icon={BroadcastIcon}
                  title="Visible to people nearby"
                  detail={s.visible ? `On. Turns off in ${minutes} min, or when you leave the app.` : `Off. Turns itself off after ${VISIBLE_FOR_MS / 60_000} minutes.`}
                  right={
                    <Switch
                      value={s.visible}
                      disabled={s.busy}
                      onValueChange={(v) => void toggle(v)}
                      trackColor={{ true: connectAccent.main, false: color.surface3 }}
                      thumbColor={color.text}
                      accessibilityLabel="Visible to people nearby"
                    />
                  }
                />
                {connected ? (
                  <Row
                    icon={LinkBreakIcon}
                    title="Disconnect everyone"
                    detail={`${plural(connected, "person", "people")} connected. They stay connected when you leave the app or turn visibility off.`}
                    onPress={() => setDisconnectOpen(true)}
                  />
                ) : null}
                <Row
                  icon={UserCircleIcon}
                  title="Name people see"
                  detail={s.myName}
                  onPress={() => {
                    setNameDraft(s.myName);
                    setNameOpen(true);
                  }}
                />
              </Group>
              {s.error ? (
                <Txt variant="small" style={{ color: color.danger, marginTop: space.sm }} accessibilityLiveRegion="polite">
                  {s.error}
                </Txt>
              ) : null}
            </View>

            {links.length ? (
              <View style={{ gap: space.sm }}>
                <SectionHeader title="Requests" />
                {links.map((l) => (
                  <LinkCard key={l.link} l={l} />
                ))}
              </View>
            ) : null}

            {s.visible ? (
              <View>
                <SectionHeader title="Nearby" />
                {nearby.length ? (
                  <Group>
                    {nearby.map(([link, n]) => (
                      <Row key={link} icon={UserCircleIcon} title={n.name} detail="Tap to ask to connect" onPress={() => void s.connect(link)} />
                    ))}
                  </Group>
                ) : (
                  <Txt variant="small">Looking for phones with Connect open and visible. Keep both phones close.</Txt>
                )}
              </View>
            ) : null}

            <Features />

            <View>
              <SectionHeader title="Chats" />
              {s.peers.length ? (
                <Group>
                  {s.peers.map((p) => {
                    const live = linkForPeer(s, p.key);
                    const detail = p.blocked ? "Blocked" : `${live ? "Connected" : "Not connected"}${p.verified ? " · Verified" : ""} · ${fingerprint(p.key)}`;
                    return (
                      <Row
                        key={p.key}
                        icon={p.blocked ? ProhibitIcon : p.verified ? CheckCircleIcon : ChatsCircleIcon}
                        title={p.name}
                        detail={detail}
                        onPress={() => router.push(`/connect/${p.key}`)}
                      />
                    );
                  })}
                </Group>
              ) : (
                <Txt variant="small">People you connect with appear here. Your chats stay on this phone.</Txt>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <Sheet open={consentOpen} onClose={() => setConsentOpen(false)} title="Before you go visible">
        <Txt variant="bodyMuted">
          While visible, phones nearby with Cowork Connect can see the name {s.myName}. Nothing else: not your email, number or location. Nobody can connect or send you anything until you accept. Visibility turns off after
          10 minutes or when you leave the app. People you already connected with stay connected until you disconnect.
        </Txt>
        <Button
          label="Go visible"
          variant="primary"
          onPress={async () => {
            await SecureStore.setItemAsync(CONSENT_KEY, "1");
            setConsentOpen(false);
            await s.goVisible();
          }}
        />
        <Button label="Not now" variant="ghost" onPress={() => setConsentOpen(false)} />
      </Sheet>

      <ConfirmSheet
        open={disconnectOpen}
        title="Disconnect everyone?"
        body="Bluetooth and Wi-Fi for Connect turn off, and Walkie channels and calls end. Your chats stay on this phone."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => {
          s.disconnectAll();
          setDisconnectOpen(false);
        }}
        onClose={() => setDisconnectOpen(false)}
      />

      <Sheet open={nameOpen} onClose={() => setNameOpen(false)} title="Name people see">
        <Input value={nameDraft} onChangeText={setNameDraft} maxLength={40} autoFocus accessibilityLabel="Name people see" />
        <Txt variant="small">Used from the next time you go visible.</Txt>
        <Button
          label="Save"
          variant="primary"
          disabled={!nameDraft.trim()}
          onPress={async () => {
            await s.setName(nameDraft);
            setNameOpen(false);
          }}
        />
      </Sheet>
    </Screen>
  );
}
