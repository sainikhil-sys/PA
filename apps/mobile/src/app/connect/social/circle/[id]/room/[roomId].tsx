import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { MusicNotesIcon, PauseIcon, PlayIcon } from "phosphor-react-native";
import * as React from "react";
import { Alert, AppState, Linking, ScrollView, Switch, View } from "react-native";
import { Button, Card, Input, Row, Screen, SectionHeader, Txt } from "@/components/ui";
import { useRoom, useRoomActions, type RoomView } from "@/features/connect/social-api";
import { Choices, formatWhen, Loaded } from "@/features/connect/social-ui";
import { connectAccent } from "@/features/connect/theme";
import { Group, SubHeader } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, font, space } from "@/theme/tokens";

const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

/**
 * Server time "now", ticking once a second while active. Every phone counts from the server's clock
 * (serverNow plus the time since that copy arrived), so a wrong phone clock does not shift the timer.
 */
function useServerNow(room: RoomView, active: boolean): number {
  const [phoneNow, setPhoneNow] = React.useState(room.receivedAt);
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setPhoneNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const skew = new Date(room.serverNow).getTime() - room.receivedAt;
  return Math.max(phoneNow, room.receivedAt) + skew;
}

function FocusPanel({ room, circleId }: { room: RoomView; circleId: string }) {
  const a = useRoomActions(circleId);
  const [minutes, setMinutes] = React.useState<"15" | "25" | "50">("25");
  const t = room.timer;
  const now = useServerNow(room, t.status === "running");
  const left = t.status === "running" && t.endsAt ? (new Date(t.endsAt).getTime() - now) / 1000 : t.status === "paused" ? (t.remainingSec ?? 0) : t.status === "idle" ? t.durationSec : 0;
  const done = t.status === "done" || (t.status === "running" && left <= 0);
  const act = (x: Parameters<typeof a.act.mutate>[0]["a"]) => a.act.mutate({ roomId: room.id, a: x });
  return (
    <Card style={{ gap: space.md, alignItems: "center" }}>
      <Txt variant="caption">{done ? "Session finished" : t.status === "running" ? "Focusing" : t.status === "paused" ? "Paused" : "Ready"}</Txt>
      <Txt style={{ fontFamily: font.semibold, fontSize: 56, lineHeight: 64, color: done ? color.muted : connectAccent.main }} accessibilityLiveRegion="polite">
        {clock(done ? 0 : left)}
      </Txt>
      {t.status === "idle" || done ? (
        <>
          <Choices
            value={minutes}
            onChange={setMinutes}
            options={[
              { value: "15", label: "15 min" },
              { value: "25", label: "25 min" },
              { value: "50", label: "50 min" },
            ]}
          />
          <Button label="Start for everyone" variant="primary" icon={PlayIcon} loading={a.act.isPending} onPress={() => act({ action: "start", minutes: Number(minutes) })} style={{ alignSelf: "stretch" }} />
        </>
      ) : (
        <View style={{ flexDirection: "row", gap: space.sm, alignSelf: "stretch" }}>
          {t.status === "running" ? (
            <Button label="Pause" icon={PauseIcon} style={{ flex: 1 }} loading={a.act.isPending} onPress={() => act({ action: "pause" })} />
          ) : (
            <Button label="Resume" icon={PlayIcon} variant="primary" style={{ flex: 1 }} loading={a.act.isPending} onPress={() => act({ action: "resume" })} />
          )}
          <Button label="Reset" variant="ghost" style={{ flex: 1 }} onPress={() => act({ action: "reset" })} />
        </View>
      )}
      <Txt variant="small" style={{ textAlign: "center" }}>
        The timer is shared: anyone in the circle can start, pause or reset it.
      </Txt>
      {a.act.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(a.act.error)}</Txt> : null}
    </Card>
  );
}

function ListenPanel({ room, circleId }: { room: RoomView; circleId: string }) {
  const a = useRoomActions(circleId);
  const [url, setUrl] = React.useState("");
  const m = room.media;
  const now = useServerNow(room, Boolean(m?.startAt));
  const startAt = m?.startAt ? new Date(m.startAt).getTime() : null;
  const offset = startAt ? (now - startAt) / 1000 : null;

  const open = () => {
    if (!m) return;
    let target = m.url;
    // YouTube links can start part way in, so a late joiner lands where everyone else is.
    if (m.kind === "youtube" && offset && offset > 2) target = `${m.url}&t=${Math.floor(offset)}s`;
    void Linking.openURL(target).catch(() => Alert.alert("Could not open the link", "Install the YouTube or Spotify app, or try again."));
  };

  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.sm }}>
        <Txt variant="small">
          Listen together syncs a link and a start time. Cowork does not stream or play any audio: each person plays it in their own {m?.kind === "spotify" ? "Spotify" : "YouTube or Spotify"} app. Spotify may need an account
          or Premium, and its links always open at the beginning.
        </Txt>
      </Card>
      {m ? (
        <Card style={{ gap: space.md }}>
          <Row icon={MusicNotesIcon} title={m.kind === "youtube" ? "YouTube" : "Spotify"} detail={m.url} />
          <Txt variant="heading" accessibilityLiveRegion="polite">
            {offset === null ? "" : offset < 0 ? `Starts in ${clock(-offset)}. Open it and press play at zero.` : `Started ${clock(offset)} ago`}
          </Txt>
          {offset !== null && offset >= 0 && m.kind === "spotify" ? <Txt variant="small">To catch up, skip to {clock(offset)} after it opens.</Txt> : null}
          <Button label={m.kind === "youtube" ? "Open in YouTube" : "Open in Spotify"} variant="primary" onPress={open} />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button label="Start again for everyone" compact style={{ flex: 1 }} onPress={() => a.act.mutate({ roomId: room.id, a: { action: "restart" } })} />
            <Button label="Clear link" variant="ghost" compact style={{ flex: 1 }} onPress={() => a.act.mutate({ roomId: room.id, a: { action: "clearMedia" } })} />
          </View>
        </Card>
      ) : null}
      <Input label={m ? "Change the link" : "Paste a YouTube or Spotify link"} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://" />
      <Button
        label="Share link with the room"
        disabled={!url.trim()}
        loading={a.act.isPending}
        onPress={() => a.act.mutate({ roomId: room.id, a: { action: "media", url: url.trim() } }, { onSuccess: () => setUrl("") })}
      />
      <Txt variant="small">Playback starts 10 seconds after the link is shared, so everyone has time to open it.</Txt>
      {a.act.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(a.act.error)}</Txt> : null}
    </View>
  );
}

/**
 * Study room (Focus Together) or listen together room. Presence is off until the person turns on
 * "Show that I am here"; then a heartbeat runs only while this screen is open and the app is in front.
 * Only "here now" is shared: never a location.
 */
export default function RoomScreen() {
  const { id: circleId, roomId } = useLocalSearchParams<{ id: string; roomId: string }>();
  const room = useRoom(circleId, roomId);
  const a = useRoomActions(circleId);
  const [here, setHere] = React.useState(false);
  const [presenceError, setPresenceError] = React.useState<string | null>(null);
  const heartbeatMs = room.data?.heartbeatMs ?? 20_000;

  useFocusEffect(
    React.useCallback(() => {
      if (!here) return;
      let stopped = false;
      const beat = () => {
        if (stopped || AppState.currentState !== "active") return;
        a.heartbeat(roomId)
          .then(() => setPresenceError(null))
          .catch((e) => setPresenceError(errorText(e)));
      };
      beat();
      const t = setInterval(beat, heartbeatMs);
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") beat();
        else void a.leave(roomId).catch(() => {});
      });
      return () => {
        stopped = true;
        clearInterval(t);
        sub.remove();
        void a.leave(roomId).catch(() => {});
      };
      // a.heartbeat and a.leave are plain functions bound to the circle.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [here, roomId, heartbeatMs]),
  );

  return (
    <Screen>
      <SubHeader title={room.data?.title ?? "Room"} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }}>
        <Loaded q={room}>
          {(r) => (
            <>
              {r.kind === "focus" ? <FocusPanel room={r} circleId={circleId} /> : <ListenPanel room={r} circleId={circleId} />}

              <View>
                <SectionHeader title="Here now" />
                <Group>
                  <Row
                    title="Show that I am here"
                    detail={here ? "On while this screen is open. Members see your name, nothing else." : "Off. Members cannot see that you are in this room."}
                    right={
                      <Switch
                        value={here}
                        onValueChange={setHere}
                        trackColor={{ true: connectAccent.main, false: color.surface3 }}
                        thumbColor={color.text}
                        accessibilityLabel="Show that I am here"
                      />
                    }
                  />
                  {r.present.length ? (
                    r.present.map((p) => <Row key={p.userId} title={p.isMe ? `${p.name} (you)` : p.name} />)
                  ) : (
                    <Row title="Nobody is showing their presence right now" />
                  )}
                </Group>
                {presenceError ? <Txt variant="small" style={{ color: color.danger, marginTop: space.sm }}>{presenceError}</Txt> : null}
              </View>

              <Txt variant="small">Updated {formatWhen(r.serverNow)}. Changes from others appear within about 10 seconds.</Txt>
              <Button
                label="Delete room"
                variant="danger"
                onPress={() =>
                  Alert.alert("Delete this room?", "It is deleted for everyone in the circle.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => a.remove.mutate(roomId, { onSuccess: () => router.back() }) },
                  ])
                }
              />
              {a.remove.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(a.remove.error)}</Txt> : null}
            </>
          )}
        </Loaded>
      </ScrollView>
    </Screen>
  );
}
