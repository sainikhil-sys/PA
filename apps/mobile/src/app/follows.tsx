import { router } from "expo-router";
import { CaretLeftIcon, UserCheckIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, View } from "react-native";
import { Button, EmptyState, ErrorState, IconButton, Screen, Skeleton, Txt } from "@/components/ui";
import { useFollow, useFollowRequests } from "@/features/feed/api";
import { PersonRow } from "@/features/social/components";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

/** People asking to follow you (private accounts and teens approve each follower). */
export default function FollowRequests() {
  const q = useFollowRequests();
  const follow = useFollow();
  const [error, setError] = React.useState<string | null>(null);
  const act = (userId: string, action: "accept" | "decline") => {
    setError(null);
    follow.mutate({ userId, action }, { onError: (e) => setError(errorText(e)) });
  };

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
        <IconButton icon={CaretLeftIcon} label="Back" tone="plain" onPress={() => router.back()} />
        <Txt variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          Follow requests
        </Txt>
      </View>
      <FlatList
        data={q.data ?? []}
        keyExtractor={(r) => r.userId}
        contentContainerStyle={{ padding: space.lg }}
        ListHeaderComponent={
          <View style={{ gap: space.sm }}>
            {error ? (
              <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
                {error}
              </Txt>
            ) : null}
            {q.isPending ? <Skeleton rows={3} height={56} /> : null}
            {q.isError && !q.data ? <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} /> : null}
            {q.data && !q.data.length ? <EmptyState icon={UserCheckIcon} title="No requests" body="When someone asks to follow you, you can approve or decline them here." /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <PersonRow
            person={{ id: item.userId, handle: item.handle, name: item.name, avatarUrl: item.avatarUrl, online: false }}
            onPress={() => router.push(`/u/${encodeURIComponent(item.handle)}`)}
            right={
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Button label="Decline" compact variant="ghost" disabled={follow.isPending} onPress={() => act(item.userId, "decline")} accessibilityLabel={`Decline ${item.name}`} />
                <Button label="Approve" compact variant="primary" disabled={follow.isPending} onPress={() => act(item.userId, "accept")} accessibilityLabel={`Approve ${item.name}`} />
              </View>
            }
          />
        )}
      />
    </Screen>
  );
}
