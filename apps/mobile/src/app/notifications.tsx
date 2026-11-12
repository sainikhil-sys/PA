import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { BellSimpleIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { Button, Divider, EmptyState, ErrorState, Screen, Skeleton, Txt } from "@/components/ui";
import { relativeTime } from "@/features/home/format";
import { BackHeader } from "@/features/home/header";
import { api, errorText } from "@/lib/api";
import { keys, useMe, useNotifications } from "@/lib/queries";
import { appRoute } from "@/lib/routes";
import type { AppNotification } from "@/lib/types";
import { color, space, TOUCH } from "@/theme/tokens";

/** Recent notifications, newest first. */
export default function NotificationsScreen() {
  const list = useNotifications();
  const me = useMe();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);

  const markRead = useMutation({
    mutationFn: () => api<{ ok: true }>("/api/mobile/notifications/read", { method: "POST" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  }, [list]);

  const unread = list.data?.unread ?? 0;
  const tz = me.data?.timezone;

  return (
    <Screen>
      <BackHeader
        title="Notifications"
        action={unread > 0 ? <Button label="Mark all read" variant="ghost" compact style={{ minHeight: TOUCH }} loading={markRead.isPending} onPress={() => markRead.mutate()} /> : null}
      />
      {markRead.isError ? (
        <Txt variant="small" accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.lg, color: color.danger }}>
          {errorText(markRead.error)}
        </Txt>
      ) : null}
      {list.isPending ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={5} height={64} />
        </View>
      ) : list.isError && !list.data ? (
        <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={list.data?.items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingBottom: space.xxxl, flexGrow: 1 }}
          ItemSeparatorComponent={() => <Divider style={{ marginLeft: space.lg }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accent} colors={[color.accent]} progressBackgroundColor={color.surface2} />}
          ListEmptyComponent={
            <EmptyState
              icon={BellSimpleIcon}
              title="No notifications"
              body="Reminders, your morning briefing, urgent email and automation results show up here."
              action={<Button label="Back to Home" compact style={{ minHeight: TOUCH }} onPress={() => router.replace("/")} />}
            />
          }
          renderItem={({ item }) => <NotificationRow item={item} tz={tz} />}
        />
      )}
    </Screen>
  );
}

function NotificationRow({ item, tz }: { item: AppNotification; tz?: string }) {
  const qc = useQueryClient();
  const route = appRoute(item.href);
  const unread = !item.readAt;
  const when = relativeTime(item.createdAt, tz);
  const content = (
    <View style={{ flexDirection: "row", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: TOUCH }}>
      <View style={{ width: 8, paddingTop: 8 }}>
        {unread ? <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color.accent }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "baseline" }}>
          <Txt variant="label" style={{ flex: 1, color: unread ? color.text : color.muted }}>
            {item.title}
          </Txt>
          <Txt variant="small">{when}</Txt>
        </View>
        {item.body ? (
          <Txt variant="small" numberOfLines={3}>
            {item.body}
          </Txt>
        ) : null}
      </View>
    </View>
  );
  const label = `${unread ? "Unread. " : ""}${item.title}${item.body ? `. ${item.body}` : ""}${when ? `. ${when}` : ""}`;
  if (!route) {
    return (
      <View accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => {
        if (unread) {
          // Mark just this one read; the list and badge refresh when it lands.
          void api("/api/mobile/notifications/read", { body: { id: item.id } })
            .then(() => Promise.all([qc.invalidateQueries({ queryKey: keys.notifications }), qc.invalidateQueries({ queryKey: keys.me })]))
            .catch(() => {});
        }
        router.push(route);
      }} style={({ pressed }) => (pressed ? { backgroundColor: color.surface2 } : undefined)}>
      {content}
    </Pressable>
  );
}
