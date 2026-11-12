import { router } from "expo-router";
import { LockIcon, RadioIcon, UsersIcon, WifiSlashIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, Switch, View } from "react-native";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, Card, EmptyState, Input, Row, Screen, SectionHeader, Txt } from "@/components/ui";
import { useAudioLevels } from "@/features/connect/audio-session";
import { ConnectAudio } from "@/features/connect/audio-native";
import { useConnect } from "@/features/connect/connect-store";
import { connectAccent } from "@/features/connect/theme";
import { useWalkie } from "@/features/connect/walkie";
import { formatCode, MAX_MEMBERS, MAX_NAME, type Channel, type Member } from "@/features/connect/walkie-logic";
import { LevelMeter, QualityLabel, TalkButton } from "@/features/connect/walkie-ui";
import { Group, SubHeader } from "@/features/settings/parts";
import { color, space } from "@/theme/tokens";

function MemberRow({ m, me, host }: { m: Member; me: string | null; host: string }) {
  const isMe = m.key === me;
  const level = useAudioLevels((s) => s.levels[isMe ? "self" : m.key] ?? 0);
  const quality = useWalkie((s) => s.quality[m.key]);
  return (
    <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
        <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
          {isMe ? "You" : m.name}
          {m.key === host ? " (made this channel)" : ""}
        </Txt>
        {isMe ? null : <QualityLabel quality={quality} />}
      </View>
      <LevelMeter level={level} label={isMe ? "Your voice level" : `${m.name} voice level`} />
    </View>
  );
}

function ChannelRoom({ c }: { c: Channel }) {
  const w = useWalkie();
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const isHost = c.host === w.me;
  const others = c.members.filter((m) => m.key !== w.me);

  return (
    <>
      <View style={{ gap: space.xs }}>
        <Txt variant="title">{c.name}</Txt>
        <Txt variant="small">
          {c.open ? "Open channel" : "Private channel"} · {c.members.length} of {MAX_MEMBERS} people
        </Txt>
        {isHost && w.code ? (
          <Card style={{ gap: space.xs, marginTop: space.sm }}>
            <Txt variant="caption">Join code</Txt>
            <Txt variant="display" accessibilityLabel={`Join code ${w.code.split("").join(" ")}`} style={{ letterSpacing: 4 }}>
              {formatCode(w.code)}
            </Txt>
            <Txt variant="small">Tell people this code in person. Anyone with it who is connected to you can join.</Txt>
          </Card>
        ) : null}
      </View>

      <TalkButton talking={w.talking} latched={w.latched} disabled={!others.length} onTalk={w.talk} />
      {!others.length ? <Txt variant="small">Nobody else is here yet. People connected to you can see this channel and join it.</Txt> : null}

      <Group>
        <Row
          title="Tap to talk"
          detail="Tap once to start talking and again to stop, instead of holding."
          right={
            <Switch value={w.latched} onValueChange={w.setLatched} trackColor={{ true: connectAccent.main, false: color.surface3 }} thumbColor={color.text} accessibilityLabel="Tap to talk" />
          }
        />
        <Row
          title="Loudspeaker"
          detail={w.speaker ? "Voices play on the loudspeaker." : "Voices play on the earpiece."}
          right={<Switch value={w.speaker} onValueChange={w.setSpeaker} trackColor={{ true: connectAccent.main, false: color.surface3 }} thumbColor={color.text} accessibilityLabel="Loudspeaker" />}
        />
      </Group>

      <View>
        <SectionHeader title="People in this channel" />
        <Group>
          {c.members.map((m) => (
            <MemberRow key={m.key} m={m} me={w.me} host={c.host} />
          ))}
        </Group>
        <Txt variant="small" style={{ marginTop: space.sm }}>
          You hear people whose phones are connected to yours. Voice is encrypted between phones and is not recorded.
        </Txt>
      </View>

      <Button label={isHost ? "End channel" : "Leave channel"} variant="danger" onPress={() => setConfirmLeave(true)} />

      <ConfirmSheet
        open={confirmLeave}
        title={isHost ? "End this channel?" : "Leave this channel?"}
        body={isHost ? "You made this channel, so leaving ends it for everyone in it." : "You stop hearing and sending voice. You can join again while it is open."}
        confirmLabel={isHost ? "End channel" : "Leave"}
        destructive
        onConfirm={async () => {
          setConfirmLeave(false);
          await w.leave();
        }}
        onClose={() => setConfirmLeave(false)}
      />
    </>
  );
}

/** Walkie: push-to-talk voice channels with people connected through Connect. No internet used. */
export default function WalkieScreen() {
  const w = useWalkie();
  const connectReady = useConnect((s) => s.ready);
  const peerCount = useConnect((s) => Object.values(s.links).filter((l) => l.phase === "secure").length);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [codeFor, setCodeFor] = React.useState<Channel | null>(null);
  const [code, setCode] = React.useState("");

  React.useEffect(() => {
    void w.start();
    // start is stable and idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const joinedChannel = w.joined ? w.channels[w.joined] : undefined;
  const listed = Object.values(w.channels).filter((c) => c.host !== w.me);
  const available = ConnectAudio.isAvailable();

  return (
    <Screen>
      <SubHeader title="Walkie" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }} keyboardShouldPersistTaps="handled">
        {w.error ? (
          <Card style={{ borderColor: color.danger, gap: space.sm }}>
            <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="assertive">
              {w.error}
            </Txt>
            <Button label="Dismiss" compact variant="ghost" onPress={w.clearMessages} style={{ alignSelf: "flex-start" }} />
          </Card>
        ) : null}
        {w.notice ? (
          <Txt variant="small" accessibilityLiveRegion="polite">
            {w.notice}
          </Txt>
        ) : null}

        {joinedChannel ? (
          <ChannelRoom c={joinedChannel} />
        ) : !available ? (
          <EmptyState icon={WifiSlashIcon} title="Not available on this phone" body="Walkie needs an Android phone with this version of Cowork and Google Play services." />
        ) : (
          <>
            <Txt variant="bodyMuted">
              Talk in a group by holding a button, like a walkie-talkie, with people connected to you in Connect. No internet or mobile signal needed. Up to {MAX_MEMBERS} people, at
              Bluetooth and Wi-Fi range.
            </Txt>

            {!connectReady || peerCount === 0 ? (
              <Card style={{ gap: space.md }}>
                <Txt variant="small">Connect with people first. Walkie uses the same connections as Connect chats.</Txt>
                <Button label="Open Connect" compact icon={UsersIcon} onPress={() => router.push("/connect")} style={{ alignSelf: "flex-start" }} />
              </Card>
            ) : null}

            <Button label="Make a channel" variant="primary" icon={RadioIcon} disabled={w.busy || Boolean(w.joining)} onPress={() => setCreateOpen(true)} />

            <View>
              <SectionHeader title="Channels near you" />
              {listed.length ? (
                <Group>
                  {listed.map((c) => {
                    const hostName = c.members.find((m) => m.key === c.host)?.name ?? "Someone";
                    const joining = w.joining === c.id;
                    return (
                      <Row
                        key={c.id}
                        icon={c.open ? RadioIcon : LockIcon}
                        title={c.name}
                        detail={`${joining ? "Joining" : c.open ? "Open" : "Needs a code"} · made by ${hostName} · ${c.count} of ${MAX_MEMBERS}`}
                        onPress={
                          w.busy || w.joining
                            ? undefined
                            : () => {
                                if (c.open) void w.join(c.id);
                                else {
                                  setCode("");
                                  setCodeFor(c);
                                }
                              }
                        }
                      />
                    );
                  })}
                </Group>
              ) : (
                <Txt variant="small">Channels made by people connected to you appear here.</Txt>
              )}
            </View>
            {w.joining ? <Button label="Cancel joining" variant="ghost" onPress={() => void w.leave()} /> : null}
          </>
        )}
      </ScrollView>

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} title="Make a channel">
        <Input label="Channel name" value={name} onChangeText={setName} maxLength={MAX_NAME} autoFocus placeholder="For example: Hiking group" />
        <Row
          title="Private"
          detail={open ? "Off. Anyone connected to you can join." : "On. People need a 6-digit code that you tell them."}
          right={<Switch value={!open} onValueChange={(v) => setOpen(!v)} trackColor={{ true: connectAccent.main, false: color.surface3 }} thumbColor={color.text} accessibilityLabel="Private channel" />}
        />
        <Txt variant="small">Cowork asks for the microphone now. While you are in the channel, a notification shows that Walkie is on.</Txt>
        <Button
          label="Make channel"
          variant="primary"
          loading={w.busy}
          disabled={!name.trim()}
          onPress={async () => {
            setCreateOpen(false);
            await w.create(name, open);
            setName("");
          }}
        />
      </Sheet>

      <Sheet open={codeFor !== null} onClose={() => setCodeFor(null)} title={codeFor ? `Join ${codeFor.name}` : "Join"}>
        <Input label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={7} autoFocus placeholder="123 456" />
        <Txt variant="small">Ask the person who made the channel for the code. Cowork asks for the microphone when you join.</Txt>
        <Button
          label="Join channel"
          variant="primary"
          loading={w.busy}
          disabled={code.replace(/\D/g, "").length !== 6}
          onPress={async () => {
            const c = codeFor;
            setCodeFor(null);
            if (c) await w.join(c.id, code);
          }}
        />
      </Sheet>
    </Screen>
  );
}
