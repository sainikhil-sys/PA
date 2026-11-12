import { router, useLocalSearchParams } from "expo-router";
import * as React from "react";
import { Alert, ScrollView, View } from "react-native";
import { Button, Card, Screen, Txt } from "@/components/ui";
import { useEvent, useEventActions } from "@/features/connect/social-api";
import { Choices, formatWhen, Loaded, ReportSheet } from "@/features/connect/social-ui";
import { SubHeader } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ev = useEvent(id);
  const a = useEventActions();
  const [reportOpen, setReportOpen] = React.useState(false);
  return (
    <Screen>
      <SubHeader title="Event" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}>
        <Loaded q={ev}>
          {(e) => (
            <>
              <View style={{ gap: space.xs }}>
                <Txt variant="title">{e.title}</Txt>
                <Txt variant="bodyMuted">
                  {formatWhen(e.startsAt)}
                  {e.endsAt ? ` to ${formatWhen(e.endsAt)}` : ""}
                </Txt>
                {e.place ? <Txt variant="bodyMuted">{e.place}</Txt> : null}
                <Txt variant="small">
                  {e.groupName ? `${e.circleId ? "Circle" : "Community"}: ${e.groupName} · ` : ""}Created by {e.mine ? "you" : e.createdBy}
                </Txt>
              </View>
              {e.description ? <Txt selectable>{e.description}</Txt> : null}
              <Card style={{ gap: space.md }}>
                <Txt variant="label">
                  {e.going} going · {e.maybe} maybe
                </Txt>
                {e.canRsvp ? (
                  <Choices
                    value={e.myRsvp}
                    onChange={(status) => a.rsvp.mutate({ id: e.id, status })}
                    options={[
                      { value: "going", label: "Going" },
                      { value: "maybe", label: "Maybe" },
                      { value: "no", label: "Not going" },
                    ]}
                  />
                ) : (
                  <Txt variant="small">Join the community to answer.</Txt>
                )}
                {a.rsvp.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(a.rsvp.error)}</Txt> : null}
              </Card>
              {e.canManage ? (
                <Button
                  label="Cancel event"
                  variant="danger"
                  loading={a.cancel.isPending}
                  onPress={() =>
                    Alert.alert("Cancel this event?", "It is removed for everyone.", [
                      { text: "Keep it", style: "cancel" },
                      { text: "Cancel event", style: "destructive", onPress: () => a.cancel.mutate(e.id, { onSuccess: () => router.back() }) },
                    ])
                  }
                />
              ) : (
                <Button label="Report event" variant="ghost" onPress={() => setReportOpen(true)} />
              )}
            </>
          )}
        </Loaded>
      </ScrollView>
      <ReportSheet target={reportOpen ? { kind: "event", id, label: "event" } : null} onClose={() => setReportOpen(false)} />
    </Screen>
  );
}
