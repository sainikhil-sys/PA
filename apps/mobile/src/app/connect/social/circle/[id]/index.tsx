import { router, useLocalSearchParams } from "expo-router";
import { SparkleIcon } from "phosphor-react-native";
import * as React from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { Button, Screen, Txt } from "@/components/ui";
import { useCircle, type ReportKind } from "@/features/connect/social-api";
import { EventsList, MembersTab, NotesTab, PollsTab, PostsTab, RoomsTab } from "@/features/connect/social-circle";
import { Choices, Loaded, ReportSheet } from "@/features/connect/social-ui";
import { SubHeader } from "@/features/settings/parts";
import { color, space } from "@/theme/tokens";

type Tab = "posts" | "polls" | "events" | "notes" | "rooms" | "members";
const TABS: { value: Tab; label: string }[] = [
  { value: "posts", label: "Posts" },
  { value: "polls", label: "Polls" },
  { value: "events", label: "Events" },
  { value: "notes", label: "Notes" },
  { value: "rooms", label: "Rooms" },
  { value: "members", label: "Members" },
];

export default function CircleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const circle = useCircle(id);
  const [tab, setTab] = React.useState<Tab>("posts");
  const [report, setReport] = React.useState<{ kind: ReportKind; id: string; label: string } | null>(null);

  return (
    <Screen>
      <SubHeader title={circle.data?.name ?? "Circle"} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}
        refreshControl={<RefreshControl refreshing={circle.isRefetching} onRefresh={() => void circle.refetch()} tintColor={color.muted} />}
      >
        <Loaded q={circle}>
          {(c) => (
            <>
              {c.description ? <Txt variant="bodyMuted">{c.description}</Txt> : null}
              <Button label="Plan something with AI" icon={SparkleIcon} onPress={() => router.push(`/connect/social/circle/${c.id}/plan`)} />
              <Choices value={tab} options={TABS} onChange={setTab} scroll />
              <View>
                {tab === "posts" ? <PostsTab circle={c} onReport={setReport} /> : null}
                {tab === "polls" ? <PollsTab circle={c} onReport={setReport} /> : null}
                {tab === "events" ? <EventsList circleId={c.id} canCreate /> : null}
                {tab === "notes" ? <NotesTab circle={c} /> : null}
                {tab === "rooms" ? <RoomsTab circle={c} /> : null}
                {tab === "members" ? <MembersTab circle={c} onReport={setReport} /> : null}
              </View>
            </>
          )}
        </Loaded>
      </ScrollView>
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </Screen>
  );
}
