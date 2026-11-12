import { router } from "expo-router";
import { BroadcastIcon, CaretRightIcon, ChatsCircleIcon, MagnifyingGlassIcon, UserPlusIcon, UsersThreeIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { Button, Divider, EmptyState, ErrorState, IconButton, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { useDebounced } from "@/features/chat/format";
import { useTabBarSpace } from "@/features/navigation/tab-bar";
import { useFriendAction, useFriends, useMessageSearch, useOpenDirect, useSocialProfile, useThreads } from "@/features/social/api";
import { PersonRow, Segments, ThreadRow, timeLabel } from "@/features/social/components";
import { JoinChats } from "@/features/social/join";
import type { Person, ThreadSummary } from "@/features/social/types";
import { ApiError, errorText } from "@/lib/api";
import { color, radius, space, TOUCH, type } from "@/theme/tokens";

type Tab = "all" | "friends" | "groups" | "requests";

/**
 * Chats: conversations with people (friends and groups). The AI assistant has its own tab and
 * its chats never appear here.
 */
export default function ChatsTab() {
  const bottom = useTabBarSpace();
  const profile = useSocialProfile();
  const joined = Boolean(profile.data?.profile);

  if (profile.isPending) {
    return (
      <Screen>
        <Header />
        <View style={{ paddingHorizontal: space.lg }}>
          <Skeleton rows={6} height={64} />
        </View>
      </Screen>
    );
  }
  if (profile.isError && !profile.data) {
    return (
      <Screen>
        <Header />
        <ErrorState
          message={profile.error instanceof ApiError && profile.error.status === 404 ? "Chats isn't available on the Cowork server yet. It will appear here once it's switched on." : errorText(profile.error)}
          onRetry={() => void profile.refetch()}
        />
      </Screen>
    );
  }
  if (!joined) {
    return (
      <Screen>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: bottom }}>
          <Header />
          <JoinChats suggestion={profile.data?.suggestion} />
        </ScrollView>
      </Screen>
    );
  }
  return <ChatsHome />;
}

function Header({ actions }: { actions?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.sm }}>
      <Txt variant="display" accessibilityRole="header" style={{ flex: 1 }}>
        Chats
      </Txt>
      {actions}
    </View>
  );
}

function ChatsHome() {
  const bottom = useTabBarSpace();
  const threads = useThreads();
  const friends = useFriends();
  const [tab, setTab] = React.useState<Tab>("all");
  const [q, setQ] = React.useState("");
  const search = useDebounced(q.trim(), 300);
  const hits = useMessageSearch(search);
  const open = useOpenDirect();
  const action = useFriendAction();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([threads.refetch(), friends.refetch()]);
    setRefreshing(false);
  }, [threads, friends]);

  const incoming = friends.data?.incoming ?? [];
  const all = threads.data ?? [];
  const lower = search.toLowerCase();
  const filtered = all.filter((t) => (tab === "groups" ? t.kind === "group" : true)).filter((t) => !lower || t.title.toLowerCase().includes(lower) || (t.preview ?? "").toLowerCase().includes(lower));
  const unreadTotal = all.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0);

  const message = (p: Person) =>
    open.mutate(p.id, {
      onSuccess: (id) => router.push(`/dm/${id}`),
    });

  let body: React.ReactNode = null;
  if (tab === "all" || tab === "groups") {
    if (threads.isPending) body = <Skeleton rows={6} height={64} />;
    else if (threads.isError && !threads.data) body = <ErrorState message={errorText(threads.error)} onRetry={() => void threads.refetch()} />;
    else if (!filtered.length && !search)
      body =
        tab === "groups" ? (
          <EmptyState icon={UsersThreeIcon} title="No groups yet" body="Start a group with friends to plan, share and talk together." action={<Button label="New group" compact icon={UsersThreeIcon} onPress={() => router.push("/dm/new-group")} />} />
        ) : (
          <EmptyState icon={ChatsCircleIcon} title="No chats yet" body="Add friends by their handle. Once they accept, you can message them here." action={<Button label="Find people" variant="primary" compact icon={UserPlusIcon} onPress={() => router.push("/people")} />} />
        );
  }

  const list: ThreadSummary[] = tab === "all" || tab === "groups" ? (body ? [] : filtered) : [];

  return (
    <Screen>
      <Header
        actions={
          <>
            <IconButton icon={UsersThreeIcon} label="New group" tone="plain" onPress={() => router.push("/dm/new-group")} />
            <IconButton icon={UserPlusIcon} label={incoming.length ? `Find people, ${incoming.length} requests` : "Find people"} tone="plain" onPress={() => router.push("/people")} />
          </>
        }
      />
      <FlatList
        data={list}
        keyExtractor={(t) => t.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accentText} colors={[color.accentText]} progressBackgroundColor={color.surface2} />}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="People nearby. Find and chat with Cowork users near you over Bluetooth and Wi-Fi, no internet needed"
              onPress={() => router.push("/connect")}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH + 16, paddingHorizontal: space.lg, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, backgroundColor: pressed ? color.surface2 : color.surface })}
            >
              <View style={{ width: 40, height: 40, borderRadius: radius.control, alignItems: "center", justifyContent: "center", backgroundColor: color.surface2 }}>
                <BroadcastIcon size={22} color={color.accentText} />
              </View>
              <View style={{ flex: 1, paddingVertical: space.sm }}>
                <Txt variant="label">People nearby</Txt>
                <Txt variant="small">Bluetooth and Wi-Fi, no internet needed</Txt>
              </View>
              <CaretRightIcon size={18} color={color.subtle} />
            </Pressable>
            <SearchBox value={q} onChange={setQ} />
            <Segments<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { key: "all", label: "All", count: unreadTotal },
                { key: "friends", label: "Friends" },
                { key: "groups", label: "Groups" },
                { key: "requests", label: "Requests", count: incoming.length },
              ]}
            />
            {threads.isError && threads.data ? (
              <Txt variant="small" accessibilityLiveRegion="polite">
                {`Couldn't refresh. ${errorText(threads.error)}`}
              </Txt>
            ) : null}
            {open.isError ? (
              <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
                {errorText(open.error)}
              </Txt>
            ) : null}
            {tab === "friends" ? <FriendsList people={friends.data?.friends} loading={friends.isPending} error={friends.isError && !friends.data ? errorText(friends.error) : null} filter={lower} onMessage={message} onRetry={() => void friends.refetch()} /> : null}
            {tab === "requests" ? <Requests data={friends.data} loading={friends.isPending} busy={action.isPending} onAction={(userId, a) => action.mutate({ userId, action: a })} error={action.isError ? errorText(action.error) : null} /> : null}
            {body}
          </View>
        }
        ItemSeparatorComponent={() => <Divider style={{ marginLeft: 64 }} />}
        renderItem={({ item }) => <ThreadRow thread={item} onPress={() => router.push(`/dm/${item.id}`)} />}
        ListFooterComponent={
          search.length >= 2 && (tab === "all" || tab === "groups") && hits.data?.length ? (
            <View style={{ marginTop: space.lg }}>
              <SectionHeader title="Messages" />
              {hits.data.map((h) => (
                <Pressable
                  key={h.messageId}
                  accessibilityRole="button"
                  accessibilityLabel={`${h.title}. ${h.sender}: ${h.body}`}
                  onPress={() => router.push(`/dm/${h.threadId}`)}
                  style={({ pressed }) => ({ paddingVertical: space.sm, minHeight: TOUCH, opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    <Txt variant="label" numberOfLines={1} style={{ flex: 1 }}>
                      {h.title}
                    </Txt>
                    <Txt variant="small" style={{ fontSize: 12 }}>
                      {timeLabel(h.createdAt)}
                    </Txt>
                  </View>
                  <Txt variant="small" numberOfLines={2}>{`${h.sender}: ${h.body}`}</Txt>
                </Pressable>
              ))}
            </View>
          ) : search && !filtered.length && (tab === "all" || tab === "groups") && !hits.isFetching ? (
            <EmptyState icon={MagnifyingGlassIcon} title="No matches" body={`No chat or message contains "${search}".`} action={<Button label="Clear search" compact icon={XIcon} onPress={() => setQ("")} />} />
          ) : undefined
        }
      />
    </Screen>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface }}>
      <MagnifyingGlassIcon size={18} color={color.subtle} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search chats and messages"
        placeholderTextColor={color.subtle}
        accessibilityLabel="Search chats and messages"
        returnKeyType="search"
        style={[type.body, { flex: 1, minHeight: TOUCH }]}
        selectionColor={color.accentText}
        cursorColor={color.accentText}
      />
      {value ? <IconButton icon={XIcon} label="Clear search" tone="plain" size={36} onPress={() => onChange("")} /> : null}
    </View>
  );
}

function FriendsList({ people, loading, error, filter, onMessage, onRetry }: { people?: Person[]; loading: boolean; error: string | null; filter: string; onMessage: (p: Person) => void; onRetry: () => void }) {
  if (loading) return <Skeleton rows={4} height={56} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  const list = (people ?? []).filter((p) => !filter || p.name.toLowerCase().includes(filter) || p.handle.includes(filter));
  if (!list.length)
    return (
      <EmptyState
        icon={UserPlusIcon}
        title={filter ? "No matching friends" : "No friends yet"}
        body={filter ? "Try another name or handle." : "Find people by their handle and send a request."}
        action={filter ? undefined : <Button label="Find people" compact icon={UserPlusIcon} onPress={() => router.push("/people")} />}
      />
    );
  const online = list.filter((p) => p.online).length;
  return (
    <View>
      <SectionHeader title={online ? `${online} active now` : `${list.length} ${list.length === 1 ? "friend" : "friends"}`} />
      {list.map((p) => (
        <PersonRow key={p.id} person={p} onPress={() => onMessage(p)} right={<Txt variant="label" style={{ color: color.accentText }}>Message</Txt>} />
      ))}
    </View>
  );
}

function Requests({
  data,
  loading,
  busy,
  error,
  onAction,
}: {
  data?: { incoming: Person[]; outgoing: Person[] };
  loading: boolean;
  busy: boolean;
  error: string | null;
  onAction: (userId: string, action: "accept" | "decline" | "cancel") => void;
}) {
  if (loading) return <Skeleton rows={3} height={56} />;
  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];
  if (!incoming.length && !outgoing.length) return <EmptyState icon={UserPlusIcon} title="No requests" body="Friend requests you receive or send show up here." />;
  return (
    <View style={{ gap: space.lg }}>
      {error ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
      {incoming.length ? (
        <View>
          <SectionHeader title="Received" />
          {incoming.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              right={
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button label="Decline" compact variant="ghost" disabled={busy} onPress={() => onAction(p.id, "decline")} accessibilityLabel={`Decline ${p.name}`} />
                  <Button label="Accept" compact variant="primary" disabled={busy} onPress={() => onAction(p.id, "accept")} accessibilityLabel={`Accept ${p.name}`} />
                </View>
              }
            />
          ))}
        </View>
      ) : null}
      {outgoing.length ? (
        <View>
          <SectionHeader title="Sent" />
          {outgoing.map((p) => (
            <PersonRow key={p.id} person={p} detail={`@${p.handle}  ·  Waiting for them`} right={<Button label="Cancel" compact variant="ghost" disabled={busy} onPress={() => onAction(p.id, "cancel")} accessibilityLabel={`Cancel request to ${p.name}`} />} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
