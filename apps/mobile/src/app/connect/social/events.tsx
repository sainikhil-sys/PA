import * as React from "react";
import { ScrollView } from "react-native";
import { Screen, Txt } from "@/components/ui";
import { EventsList } from "@/features/connect/social-circle";
import { SubHeader } from "@/features/settings/parts";
import { space } from "@/theme/tokens";

/** Upcoming events from every circle and community you are in. */
export default function EventsScreen() {
  return (
    <Screen>
      <SubHeader title="Upcoming events" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}>
        <Txt variant="bodyMuted">From your circles and the communities you joined. To add one, open a circle or community.</Txt>
        <EventsList canCreate={false} />
      </ScrollView>
    </Screen>
  );
}
