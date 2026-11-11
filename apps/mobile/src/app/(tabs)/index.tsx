import { setChatIntent } from "@/lib/intent";
import { router } from "expo-router";
import { BellIcon, CalendarDotsIcon, ChatCircleIcon, MagnifyingGlassIcon, NotebookIcon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Orb } from "@/components/orb";
import { Button, CountBadge, ErrorState, IconButton, Screen, Txt } from "@/components/ui";
import { ApprovalsWaitingCard, BriefingCard, MailCard, ScheduleCard, TasksCard } from "@/features/home/cards";
import { firstName, greeting, longDay } from "@/features/home/format";
import { errorText } from "@/lib/api";
import { useMe, useToday } from "@/lib/queries";
import { color, radius, space, TOUCH, type } from "@/theme/tokens";

/** Home: the day at a glance, the voice orb, and what is waiting on you. */
export default function HomeScreen() {
  const today = useToday();
  const me = useMe();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([today.refetch(), me.refetch()]);
    setRefreshing(false);
  }, [today, me]);

  const tz = today.data?.timezone ?? me.data?.timezone;
  const name = firstName(me.data?.name);
  const unread = me.data?.unreadNotifications ?? 0;
  const loading = today.isPending;
  const failed = today.isError && !today.data;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxxl, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.orange} colors={[color.orange]} progressBackgroundColor={color.surface2} />}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Txt variant="caption">{today.data ? longDay(today.data.date) : " "}</Txt>
            <Txt variant="display" accessibilityRole="header" style={{ marginTop: space.xs }}>
              {name ? `${greeting(tz)}, ${name}` : greeting(tz)}
            </Txt>
          </View>
          <IconButton icon={MagnifyingGlassIcon} label="Search" onPress={() => router.push("/search")} />
          <View>
            <IconButton icon={BellIcon} label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} onPress={() => router.push("/notifications")} />
            {unread > 0 ? (
              <View pointerEvents="none" style={{ position: "absolute", top: -6, right: -6 }}>
                <CountBadge count={unread} />
              </View>
            ) : null}
          </View>
        </View>

        <View style={{ alignItems: "center", marginTop: space.sm }}>
          <Orb size={150} onPress={() => {
            setChatIntent({ listen: true });
            router.push("/chat/new");
          }} />
          <Txt variant="small">Tap to talk</Txt>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask anything. Opens a new chat."
          onPress={() => router.push("/chat/new")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            minHeight: TOUCH + 4,
            paddingHorizontal: space.lg,
            borderRadius: radius.control,
            borderWidth: 1,
            borderColor: color.borderStrong,
            backgroundColor: pressed ? color.surface2 : color.surface,
            marginBottom: space.sm,
          })}
        >
          <ChatCircleIcon size={20} color={color.subtle} />
          <Txt style={[type.body, { color: color.subtle, flex: 1 }]} numberOfLines={1}>
            Ask anything
          </Txt>
        </Pressable>

        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Notes" icon={NotebookIcon} compact style={{ flex: 1, minHeight: TOUCH }} onPress={() => router.push("/notes")} />
          <Button label="Next 7 days" icon={CalendarDotsIcon} compact style={{ flex: 1, minHeight: TOUCH }} onPress={() => router.push("/agenda")} />
        </View>

        {failed ? (
          <ErrorState message={errorText(today.error)} onRetry={() => void today.refetch()} />
        ) : (
          <>
            {today.isError && today.data ? (
              <Txt variant="small" accessibilityLiveRegion="polite">
                Couldn't refresh. {errorText(today.error)}
              </Txt>
            ) : null}
            {today.data && today.data.pendingApprovals > 0 ? <ApprovalsWaitingCard count={today.data.pendingApprovals} /> : null}
            <BriefingCard briefing={today.data?.briefing} loading={loading} />
            <ScheduleCard today={today.data} loading={loading} />
            <TasksCard today={today.data} loading={loading} />
            <MailCard today={today.data} loading={loading} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
