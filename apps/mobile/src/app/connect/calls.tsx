import { router } from "expo-router";
import { CheckSquareIcon, PhoneIcon, PhoneIncomingIcon, PhoneOutgoingIcon, PhoneXIcon, SquareIcon, WifiSlashIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, Card, EmptyState, Row, Screen, SectionHeader, Txt } from "@/components/ui";
import { ConnectAudio } from "@/features/connect/audio-native";
import { useCalls } from "@/features/connect/calls";
import { callTitle, formatDuration, HISTORY_TEXT, isLive, MAX_CALL_PEOPLE } from "@/features/connect/calls-logic";
import type { CallRow } from "@/features/connect/calls-store";
import { useConnect } from "@/features/connect/connect-store";
import { connectAccent } from "@/features/connect/theme";
import { Group, SubHeader, timeAgo } from "@/features/settings/parts";
import { color, space } from "@/theme/tokens";

function historyDetail(r: CallRow) {
  const when = timeAgo(new Date(r.startedAt).toISOString());
  const dir = r.direction === "outgoing" ? "Outgoing" : "Incoming";
  const status = r.status === "completed" && r.connectedAt !== null ? formatDuration(r.endedAt - r.connectedAt) : HISTORY_TEXT[r.status];
  return `${dir} · ${status} · ${when}`;
}

/** Offline calls: start a call with people connected right now, and see past calls. */
export default function CallsScreen() {
  const calls = useCalls();
  const links = useConnect((s) => s.links);
  const people = React.useMemo(
    () =>
      Object.values(links)
        .filter((l) => l.phase === "secure" && l.peerKey)
        .map((l) => ({ key: l.peerKey!, name: l.name })),
    [links],
  );
  const [picked, setPicked] = React.useState<string[]>([]);
  const [confirmClear, setConfirmClear] = React.useState(false);

  React.useEffect(() => {
    void calls.start();
    // start is stable and idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop people from the selection when they disconnect.
  const chosen = picked.filter((k) => people.some((p) => p.key === k));
  const max = MAX_CALL_PEOPLE - 1;
  const toggle = (key: string) => setPicked((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= max ? cur : [...cur, key]));
  const available = ConnectAudio.isAvailable();
  const live = isLive(calls.call) ? calls.call : null;

  const start = async () => {
    const id = await calls.startCall(chosen);
    if (id) {
      setPicked([]);
      router.push(`/connect/call/${id}`);
    }
  };

  return (
    <Screen>
      <SubHeader title="Calls" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }}>
        <Txt variant="bodyMuted">
          Voice calls with people connected to you in Connect, with no internet or mobile signal. Both phones need Connect open and connected to each other, so calls reach people within Bluetooth and Wi-Fi
          range. Android only for now. Calls are encrypted between phones and never recorded.
        </Txt>

        {live ? (
          <Card onPress={() => router.push(`/connect/call/${live.id}`)} accessibilityLabel={live.phase === "incoming" ? "Open the incoming call" : "Return to the call"} style={{ borderColor: connectAccent.main }}>
            <Txt variant="label">{live.phase === "incoming" ? `Incoming call from ${callTitle(live.participants.filter((p) => p.key === live.host))}` : `Call in progress with ${callTitle(live.participants)}`}</Txt>
            <Txt variant="small">{live.phase === "incoming" ? "Tap to answer or decline." : "Tap to return to the call."}</Txt>
          </Card>
        ) : null}

        {calls.error ? (
          <Card style={{ borderColor: color.danger, gap: space.sm }}>
            <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="assertive">
              {calls.error}
            </Txt>
            <Button label="Dismiss" compact variant="ghost" onPress={calls.clearError} style={{ alignSelf: "flex-start" }} />
          </Card>
        ) : null}

        {!available ? (
          <EmptyState icon={WifiSlashIcon} title="Not available on this phone" body="Calls need an Android phone with this version of Cowork and Google Play services." />
        ) : (
          <View>
            <SectionHeader title={`Start a call (up to ${max} people)`} />
            {people.length ? (
              <>
                <Group>
                  {people.map((p) => {
                    const on = chosen.includes(p.key);
                    return (
                      <Row
                        key={p.key}
                        icon={on ? CheckSquareIcon : SquareIcon}
                        title={p.name}
                        detail={on ? "In this call" : chosen.length >= max ? "The call is full" : "Connected"}
                        onPress={() => toggle(p.key)}
                      />
                    );
                  })}
                </Group>
                <Button
                  label={chosen.length ? `Call ${callTitle(people.filter((p) => chosen.includes(p.key)))}` : "Choose who to call"}
                  variant="primary"
                  icon={PhoneIcon}
                  disabled={!chosen.length || Boolean(live)}
                  loading={calls.busy}
                  onPress={() => void start()}
                  style={{ marginTop: space.md }}
                />
              </>
            ) : (
              <Card style={{ gap: space.md }}>
                <Txt variant="small">Nobody is connected right now. Connect with someone first, then call them.</Txt>
                <Button label="Open Connect" compact onPress={() => router.push("/connect")} style={{ alignSelf: "flex-start" }} />
              </Card>
            )}
          </View>
        )}

        <View>
          <SectionHeader
            title="Recent calls"
            action={calls.history.length ? <Button label="Clear" compact variant="ghost" onPress={() => setConfirmClear(true)} accessibilityLabel="Clear call history" /> : undefined}
          />
          {calls.history.length ? (
            <Group>
              {calls.history.map((r) => (
                <Row
                  key={r.id}
                  icon={r.status === "missed" || r.status === "failed" ? PhoneXIcon : r.direction === "outgoing" ? PhoneOutgoingIcon : PhoneIncomingIcon}
                  title={callTitle(r.people)}
                  detail={historyDetail(r)}
                />
              ))}
            </Group>
          ) : (
            <Txt variant="small">Calls you make and get appear here. History stays on this phone.</Txt>
          )}
        </View>
      </ScrollView>

      <ConfirmSheet
        open={confirmClear}
        title="Clear call history?"
        body="Removes the list of past calls from this phone. It cannot be undone."
        confirmLabel="Clear history"
        destructive
        onConfirm={async () => {
          setConfirmClear(false);
          await calls.clearHistory();
        }}
        onClose={() => setConfirmClear(false)}
      />
    </Screen>
  );
}
