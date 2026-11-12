import { router, type Href } from "expo-router";
import { ArrowRightIcon, BellIcon, CaretRightIcon, ChatCircleIcon, CheckSquareIcon, DotsThreeIcon, FadersIcon, MagnifyingGlassIcon, MicrophoneIcon, NotePencilIcon, type Icon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Sheet } from "@/components/sheet";
import { ErrorState, IconButton, Row, Screen, Skeleton, Txt } from "@/components/ui";
import { AnnouncementBanners, HomeNoticeCards } from "@/features/config/notices";
import { ApprovalsWaitingCard, BriefingCard, MailCard, ScheduleCard, TasksCard } from "@/features/home/cards";
import { relativeTime } from "@/features/home/format";
import { useTabBarSpace } from "@/features/navigation/tab-bar";
import { errorText } from "@/lib/api";
import { setChatIntent } from "@/lib/intent";
import { useConversations, useMe, useToday } from "@/lib/queries";
import { color, font, radius, space, TOUCH } from "@/theme/tokens";
import { feedback } from "@/lib/feedback";

/** What the search filter can narrow to (matches the groups on the Search screen). */
const SEARCH_KINDS: { kind: string; label: string }[] = [
  { kind: "chats", label: "Chats" },
  { kind: "tasks", label: "Tasks" },
  { kind: "notes", label: "Notes and links" },
  { kind: "documents", label: "Documents" },
  { kind: "memories", label: "Memories" },
];

type Quick = { key: string; icon: Icon; label: string; go: () => void };

/** Home: what's happening today, a search over everything, quick starts and your recent chats. */
export default function HomeScreen() {
  const today = useToday();
  const me = useMe();
  const chats = useConversations("");
  const bottom = useTabBarSpace();
  const [refreshing, setRefreshing] = React.useState(false);
  const [filterOpen, setFilterOpen] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([today.refetch(), me.refetch(), chats.refetch()]);
    setRefreshing(false);
  }, [today, me, chats]);

  const tz = today.data?.timezone ?? me.data?.timezone;
  const unread = me.data?.unreadNotifications ?? 0;
  const loading = today.isPending;
  const failed = today.isError && !today.data;
  const recent = (chats.data ?? []).slice(0, 3);

  const quick: Quick[] = [
    { key: "chat", icon: ChatCircleIcon, label: "New chat", go: () => router.push("/chat/new") },
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
    { key: "note", icon: NotePencilIcon, label: "New note", go: () => router.push("/notes/new") },
    { key: "more", icon: DotsThreeIcon, label: "More", go: () => router.push("/workspace") },
  ];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: bottom, gap: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accentText} colors={[color.accentText]} progressBackgroundColor={color.surface2} />}
      >
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

        <View style={{ gap: space.lg }}>
          <Txt variant="display" accessibilityRole="header" style={{ fontSize: 36, lineHeight: 42 }}>
            {"What's happening?"}
          </Txt>
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Pressable
              accessibilityRole="search"
              accessibilityLabel="Search chats, tasks, notes, documents and memories"
              onPress={() => router.push("/search")}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                minHeight: TOUCH + 8,
                paddingHorizontal: space.lg,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: color.borderStrong,
                backgroundColor: pressed ? color.surface2 : color.surface,
              })}
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
              style={({ pressed }) => ({
                width: TOUCH + 8,
                minHeight: TOUCH + 8,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: color.borderStrong,
                backgroundColor: pressed ? color.surface2 : color.surface,
              })}
            >
              <FadersIcon size={20} color={color.text} />
            </Pressable>
          </View>
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
              <View style={{ width: 56, height: 56, borderRadius: radius.card, alignItems: "center", justifyContent: "center", backgroundColor: color.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: color.border }}>
                <q.icon size={24} color={q.key === "chat" ? color.accentText : color.text} />
              </View>
              <Txt variant="small" numberOfLines={1} style={{ color: color.text, fontSize: 12 }}>
                {q.label}
              </Txt>
            </Pressable>
          ))}
        </View>

        <View>
          <SectionTitle title="Recent with your assistant" onSeeAll={() => router.push("/assistant")} />
          {chats.isPending ? (
            <Skeleton rows={3} height={56} />
          ) : chats.isError && !chats.data ? (
            <Txt variant="small">{`Couldn't load your chats. ${errorText(chats.error)}`}</Txt>
          ) : recent.length === 0 ? (
            <Txt variant="small">Your chats with Cowork show up here. Start one above.</Txt>
          ) : (
            recent.map((c, i) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`${c.title || "Untitled chat"}, ${relativeTime(c.updatedAt, tz)}`}
                onPress={() => router.push(`/chat/${c.id}`)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64, paddingVertical: space.sm, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: color.border, opacity: pressed ? 0.7 : 1 })}
              >
                <View style={{ width: 44, height: 44, borderRadius: radius.control, alignItems: "center", justifyContent: "center", backgroundColor: color.surface }}>
                  <ChatCircleIcon size={22} color={color.accentText} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="label" numberOfLines={1}>
                    {c.title?.trim() || "Untitled chat"}
                  </Txt>
                  <Txt variant="small">{relativeTime(c.updatedAt, tz)}</Txt>
                </View>
                <CaretRightIcon size={18} color={color.subtle} />
              </Pressable>
            ))
          )}
        </View>

        <View style={{ gap: space.md }}>
          <SectionTitle title="Today" />
          <HomeNoticeCards />
          {failed ? (
            <ErrorState message={errorText(today.error)} onRetry={() => void today.refetch()} />
          ) : (
            <>
              {today.isError && today.data ? <Txt variant="small" accessibilityLiveRegion="polite">{`Couldn't refresh. ${errorText(today.error)}`}</Txt> : null}
              {today.data && today.data.pendingApprovals > 0 ? <ApprovalsWaitingCard count={today.data.pendingApprovals} /> : null}
              <BriefingCard briefing={today.data?.briefing} loading={loading} />
              <ScheduleCard today={today.data} loading={loading} />
              <TasksCard today={today.data} loading={loading} />
              <MailCard today={today.data} loading={loading} />
            </>
          )}
        </View>
      </ScrollView>

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

/** A section heading with an optional "See all" link, like the reference layout. */
function SectionTitle({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm, minHeight: TOUCH }}>
      <Txt variant="title" accessibilityRole="header">
        {title}
      </Txt>
      {onSeeAll ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`See all ${title.toLowerCase()}`} onPress={onSeeAll} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: TOUCH, opacity: pressed ? 0.6 : 1 })}>
          <Txt variant="label">See all</Txt>
          <ArrowRightIcon size={16} color={color.text} />
        </Pressable>
      ) : null}
    </View>
  );
}
