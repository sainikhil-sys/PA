import { useLocalSearchParams } from "expo-router";
import * as React from "react";
import { ScrollView, View } from "react-native";
import { Button, Screen, SectionHeader, Txt } from "@/components/ui";
import { useCommunity, useCommunityActions } from "@/features/connect/social-api";
import { EventsList } from "@/features/connect/social-circle";
import { Loaded, ReportSheet } from "@/features/connect/social-ui";
import { SubHeader } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

export default function CommunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const community = useCommunity(id);
  const a = useCommunityActions();
  const [reportOpen, setReportOpen] = React.useState(false);
  return (
    <Screen>
      <SubHeader title={community.data?.name ?? "Community"} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }}>
        <Loaded q={community}>
          {(c) => (
            <>
              <View style={{ gap: space.sm }}>
                <Txt variant="small">
                  {c.kind === "campus" ? "Campus" : "Interest"} community · {c.members} {c.members === 1 ? "member" : "members"}
                </Txt>
                {c.description ? <Txt variant="bodyMuted">{c.description}</Txt> : null}
              </View>
              {c.joined ? (
                <Button label="Leave community" variant="danger" loading={a.leave.isPending} onPress={() => a.leave.mutate(c.id)} />
              ) : (
                <Button label="Join community" variant="primary" loading={a.join.isPending} onPress={() => a.join.mutate(c.id)} />
              )}
              {a.join.error || a.leave.error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(a.join.error ?? a.leave.error)}</Txt> : null}
              <View>
                <SectionHeader title="Upcoming events" />
                <EventsList communityId={c.id} canCreate={c.joined} />
              </View>
              <Button label="Report community" variant="ghost" onPress={() => setReportOpen(true)} />
            </>
          )}
        </Loaded>
      </ScrollView>
      <ReportSheet target={reportOpen ? { kind: "community", id, label: "community" } : null} onClose={() => setReportOpen(false)} />
    </Screen>
  );
}
