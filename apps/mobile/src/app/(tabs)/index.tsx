import { router, type Href } from "expo-router";
import { BellIcon, CaretDownIcon, CaretRightIcon, CaretUpIcon, ChatCircleIcon, CheckSquareIcon, DotsThreeIcon, FadersIcon, MagnifyingGlassIcon, MicrophoneIcon, NoteBlankIcon, PencilSimpleLineIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Sheet } from "@/components/sheet";
import { Button, Divider, EmptyState, ErrorState, IconButton, Row, Screen, Skeleton, Txt } from "@/components/ui";
import { useFeed } from "@/features/feed/api";
import { PostCard } from "@/features/feed/components";
import type { FeedTab } from "@/features/feed/types";
import { AnnouncementBanners, HomeNoticeCards } from "@/features/config/notices";
import { ApprovalsWaitingCard, BriefingCard, MailCard, ScheduleCard, TasksCard } from "@/features/home/cards";
import { useTabBarSpace } from "@/features/navigation/tab-bar";
import { Segments } from "@/features/social/components";
import { errorText } from "@/lib/api";
import { feedback } from "@/lib/feedback";
import { setChatIntent } from "@/lib/intent";
import { useMe, useToday } from "@/lib/queries";
import { color, font, radius, space, TOUCH } from "@/theme/tokens";

/** What the search filter can narrow to (matches the groups on the Search screen). */
const SEARCH_KINDS: { kind: string; label: string }[] = [
  { kind: "chats", label: "Chats" },
  { kind: "tasks", label: "Tasks" },
  { kind: "notes", label: "Notes and links" },
  { kind: "documents", label: "Documents" },
  { kind: "memories", label: "Memories" },
];

type Quick = { key: string; icon: Icon; label: string; go: () => void };

const FEED_EMPTY: Record<FeedTab, { title: string; body: string }> = {
  following: { title: "Nothing here yet", body: "Follow people to see their posts, or share your first post." },
  foryou: { title: "Nothing to show yet", body: "Public posts from across Cowork appear here." },
  saved: { title: "No saved posts", body: "Tap the bookmark on a post to keep it here." },
};

/**
 * Home: your day at the top (search, quick starts, today's plan, folded by default), then the feed of
 * posts from people you follow, everyone, or what you saved.
 */
export default function HomeScreen() {
  const today = useToday();
  const me = useMe();
  const bottom = useTabBarSpace();
  const [tab, setTab] = React.useState<FeedTab>("following");
  const feed = useFeed(tab);
  const [refreshing, setRefreshing] = React.useState(false);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [showToday, setShowToday] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([today.refetch(), me.refetch(), feed.refetch()]);
    setRefreshing(false);
  }, [today, me, feed]);

  const unread = me.data?.unreadNotifications ?? 0;
  const loading = today.isPending;
  const failed = today.isError && !today.data;
  const posts = (feed.data?.pages ?? []).flatMap((p) => p.items);

  const quick: Quick[] = [
    { key: "post", icon: PencilSimpleLineIcon, label: "New post", go: () => router.push("/post/new") },
    { key: "chat", icon: ChatCircleIcon, label: "Ask", go: () => router.push("/chat/new") },
    {
      key: "talk",
      icon: MicrophoneIcon,
      label: "Talk",
      go: () => {
        setChatIntent({ listen: true });
        router.push("/chat/new");
      },
    },
    { key: "task", icon: CheckSquareIcon, label: "New task", go: () => router.push("/tasks?add=1") },
    { key: "more", icon: DotsThreeIcon, label: "More", go: () => router.push("/workspace") },
  ];

  const events = today.data?.events.length ?? 0;
  const openTasks = today.data?.tasks.length ?? 0;

  const header = (
    <View style={{ gap: space.xl, paddingTop: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text accessibilityRole="header" accessibilityLabel="Cowork" style={{ fontFamily: font.semibold, fontSize: 26, letterSpacing: -0.6, color: color.text }} maxFontSizeMultiplier={1.3}>
          cowork
        </Text>
        <View>
          <IconButton icon={BellIcon} tone="plain" label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} onPress={() => router.push("/notifications")} />
          {unread > 0 ? (
            <View pointerEvents="none" style={{ position: "absolute", top: 4, right: 2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: color.text, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 11, color: color.bg }}>{unread > 99 ? "99+" : unread}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <AnnouncementBanners />

      <View style={{ flexDirection: "row", gap: space.md }}>
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Search chats, tasks, notes, documents and memories"
          onPress={() => router.push("/search")}
          style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH + 4, paddingHorizontal: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: pressed ? color.surface2 : color.surface })}
        >
          <MagnifyingGlassIcon size={20} color={color.subtle} />
          <Txt variant="bodyMuted" numberOfLines={1} style={{ color: color.subtle }}>
            Search chats, tasks, notes
          </Txt>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search filters"
          onPress={() => setFilterOpen(true)}
          style={({ pressed }) => ({ width: TOUCH + 4, minHeight: TOUCH + 4, alignItems: "center", justifyContent: "center", borderRadius: radius.card, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: pressed ? color.surface2 : color.surface })}
        >
          <FadersIcon size={20} color={color.text} />
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {quick.map((q) => (
          <Pressable
            key={q.key}
            accessibilityRole="button"
            accessibilityLabel={q.label}
            onPress={() => {
              feedback.selection();
              q.go();
            }}
            style={({ pressed }) => ({ alignItems: "center", gap: space.sm, width: 64, opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ width: 52, height: 52, borderRadius: radius.card, alignItems: "center", justifyContent: "center", backgroundColor: q.key === "post" ? color.accent : color.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: q.key === "post" ? color.accent : color.border }}>
              <q.icon size={22} color={q.key === "post" ? color.onAccent : color.text} />
            </View>
            <Txt variant="small" numberOfLines={1} style={{ color: color.text, fontSize: 12 }}>
              {q.label}
            </Txt>
          </Pressable>
        ))}
      </View>

      <View style={{ gap: space.md }}>
        <HomeNoticeCards />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showToday }}
          accessibilityLabel={showToday ? "Hide today's plan" : "Show today's plan"}
          onPress={() => setShowToday((v) => !v)}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH + 8, paddingHorizontal: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, backgroundColor: pressed ? color.surface2 : color.surface })}
        >
          <View style={{ flex: 1 }}>
            <Txt variant="label">Today</Txt>
            <Txt variant="small" numberOfLines={1}>
              {loading
                ? "Loading your day..."
                : failed
                  ? "Couldn't load your day"
                  : [today.data?.pendingApprovals ? `${today.data.pendingApprovals} waiting for you` : null, events ? `${events} ${events === 1 ? "event" : "events"}` : null, openTasks ? `${openTasks} ${openTasks === 1 ? "task" : "tasks"}` : null].filter(Boolean).join("  ·  ") || "Briefing, schedule, tasks and mail"}
            </Txt>
          </View>
          {showToday ? <CaretUpIcon size={18} color={color.muted} /> : <CaretDownIcon size={18} color={color.muted} />}
        </Pressable>
        {showToday ? (
          failed ? (
            <ErrorState message={errorText(today.error)} onRetry={() => void today.refetch()} />
          ) : (
            <View style={{ gap: space.md }}>
              {today.data && today.data.pendingApprovals > 0 ? <ApprovalsWaitingCard count={today.data.pendingApprovals} /> : null}
              <BriefingCard briefing={today.data?.briefing} loading={loading} />
              <ScheduleCard today={today.data} loading={loading} />
              <TasksCard today={today.data} loading={loading} />
              <MailCard today={today.data} loading={loading} />
            </View>
          )
        ) : null}
      </View>

      <View style={{ gap: space.md }}>
        <Txt variant="title" accessibilityRole="header">
          Feed
        </Txt>
        <Segments<FeedTab>
          value={tab}
          onChange={setTab}
          options={[
            { key: "following", label: "Following" },
            { key: "foryou", label: "For you" },
            { key: "saved", label: "Saved" },
          ]}
        />
        {feed.isPending ? <Skeleton rows={3} height={120} /> : null}
        {feed.isError && !feed.data ? <ErrorState message={errorText(feed.error)} onRetry={() => void feed.refetch()} /> : null}
        {feed.isError && feed.data ? <Txt variant="small" accessibilityLiveRegion="polite">{`Couldn't refresh. ${errorText(feed.error)}`}</Txt> : null}
        {feed.data && !posts.length ? (
          <EmptyState
            icon={NoteBlankIcon}
            title={FEED_EMPTY[tab].title}
            body={FEED_EMPTY[tab].body}
            action={tab === "saved" ? undefined : <Button label="New post" variant="primary" compact icon={PencilSimpleLineIcon} onPress={() => router.push("/post/new")} />}
          />
        ) : null}
      </View>
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: bottom }}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <Divider />}
        renderItem={({ item }) => <PostCard post={item} />}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color={color.accentText} style={{ margin: space.lg }} /> : undefined}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accentText} colors={[color.accentText]} progressBackgroundColor={color.surface2} />}
      />

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Search in">
        <View>
          {SEARCH_KINDS.map((k) => (
            <Row
              key={k.kind}
              title={k.label}
              onPress={() => {
                setFilterOpen(false);
                router.push(`/search?kind=${k.kind}` as Href);
              }}
              right={<CaretRightIcon size={18} color={color.subtle} />}
            />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
