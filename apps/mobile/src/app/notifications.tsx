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
import type { AppNotification } from "@/lib/types";
import { color, space, TOUCH } from "@/theme/tokens";

/** Where a notification's web link goes in the app, or null when the app has no matching screen. */
function appRoute(href: string | null): string | null {
  if (!href) return null;
  if (href.startsWith("/chat/")) return href;
  if (href === "/approvals" || href.startsWith("/approvals?")) return "/approvals";
  if (href === "/tasks" || href.startsWith("/tasks?")) {
    const task = /[?&]task=([\w-]+)/.exec(href)?.[1];
    return task ? `/task/${task}` : "/(tabs)/tasks";
  }
  return null;
}

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
        action={unread > 0 ? <Button label="Mark all read" variant="ghost" compact loading={markRead.isPending} onPress={() => markRead.mutate()} /> : null}
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.orange} colors={[color.orange]} progressBackgroundColor={color.surface2} />}
          ListEmptyComponent={
            <EmptyState
              icon={BellSimpleIcon}
              title="No notifications"
              body="Reminders, finished tasks and items that need your approval show up here."
              action={<Button label="Back to Home" compact onPress={() => router.replace("/")} />}
            />
          }
          renderItem={({ item }) => <NotificationRow item={item} tz={tz} />}
        />
      )}
    </Screen>
  );
}

function NotificationRow({ item, tz }: { item: AppNotification; tz?: string }) {
  const route = appRoute(item.href);
  const unread = !item.readAt;
  const content = (
    <View style={{ flexDirection: "row", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: TOUCH }}>
      <View style={{ width: 8, paddingTop: 8 }}>
        {unread ? <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color.orange }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "baseline" }}>
          <Txt variant="label" style={{ flex: 1, color: unread ? color.text : color.muted }}>
            {item.title}
          </Txt>
          <Txt variant="small">{relativeTime(item.createdAt, tz)}</Txt>
        </View>
        {item.body ? (
          <Txt variant="small" numberOfLines={3}>
            {item.body}
          </Txt>
        ) : null}
      </View>
    </View>
  );
  const label = `${unread ? "Unread. " : ""}${item.title}${item.body ? `. ${item.body}` : ""}`;
  if (!route) {
    return (
      <View accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push(route)} style={({ pressed }) => (pressed ? { backgroundColor: color.surface2 } : undefined)}>
      {content}
    </Pressable>
  );
}
