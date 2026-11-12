import { router, useLocalSearchParams } from "expo-router";
import { CaretLeftIcon, ChatCircleIcon, LockSimpleIcon, NoteBlankIcon, UserPlusIcon } from "phosphor-react-native";
import * as React from "react";
import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { ConfirmSheet } from "@/components/sheet";
import { Button, Divider, EmptyState, ErrorState, IconButton, Screen, Skeleton, Txt } from "@/components/ui";
import { useFollow, usePerson } from "@/features/feed/api";
import { PostCard } from "@/features/feed/components";
import { useOpenDirect } from "@/features/social/api";
import { PersonAvatar } from "@/features/social/components";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

/** Someone's profile: who they are, follow or message them, and the posts you're allowed to see. */
export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const q = usePerson(handle);
  const follow = useFollow();
  const openDirect = useOpenDirect();
  const [confirmUnfollow, setConfirmUnfollow] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const head = q.data?.pages[0]?.profile;
  const posts = (q.data?.pages ?? []).flatMap((p) => p.posts.items);

  const act = (action: "follow" | "unfollow") => {
    if (!head) return;
    setError(null);
    follow.mutate({ userId: head.id, action }, { onError: (e) => setError(errorText(e)) });
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
      <IconButton icon={CaretLeftIcon} label="Back" tone="plain" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      <Txt variant="heading" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>
        {head ? `@${head.handle}` : "Profile"}
      </Txt>
    </View>
  );

  if (q.isPending)
    return (
      <Screen>
        {header}
        <View style={{ padding: space.lg }}>
          <Skeleton rows={4} />
        </View>
      </Screen>
    );
  if (!head)
    return (
      <Screen>
        {header}
        <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
      </Screen>
    );

  const self = head.followState === "self";
  const followLabel = head.followState === "following" ? "Following" : head.followState === "requested" ? "Requested" : head.privateAccount ? "Request to follow" : "Follow";

  return (
    <Screen>
      {header}
      <FlatList
        data={head.canSeePosts ? posts : []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await q.refetch();
              setRefreshing(false);
            }}
            tintColor={color.accentText}
            colors={[color.accentText]}
            progressBackgroundColor={color.surface2}
          />
        }
        onEndReached={() => {
          if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ItemSeparatorComponent={() => <Divider />}
        ListHeaderComponent={
          <View style={{ alignItems: "center", gap: space.sm, paddingVertical: space.xl }}>
            <PersonAvatar name={head.name} url={head.avatarUrl} size={88} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
              <Txt variant="title">{head.name}</Txt>
              {head.privateAccount ? (
                <View accessible accessibilityLabel="Private account">
                  <LockSimpleIcon size={16} color={color.muted} />
                </View>
              ) : null}
            </View>
            <Txt variant="small">{`@${head.handle}${head.friends ? "  ·  Friends in Chats" : ""}`}</Txt>
            <Txt variant="small" style={{ color: color.text }}>{`${head.followers} ${head.followers === 1 ? "follower" : "followers"}  ·  ${head.following} following`}</Txt>
            {error ? (
              <Txt variant="small" style={{ color: color.danger, textAlign: "center" }} accessibilityLiveRegion="polite">
                {error}
              </Txt>
            ) : null}
            {self ? (
              <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.sm }}>
                <Button label="Edit profile" compact onPress={() => router.push("/people/settings")} />
                <Button label="Follow requests" compact onPress={() => router.push("/follows")} />
              </View>
            ) : head.blocked ? (
              <Txt variant="small" style={{ marginTop: space.sm }}>
                You blocked this person. Unblock them in Chats privacy to follow or message them.
              </Txt>
            ) : (
              <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.sm }}>
                <Button
                  label={followLabel}
                  variant={head.followState === "none" ? "primary" : "secondary"}
                  compact
                  loading={follow.isPending}
                  onPress={() => (head.followState === "none" ? act("follow") : setConfirmUnfollow(true))}
                />
                {head.friends ? (
                  <Button
                    label="Message"
                    compact
                    icon={ChatCircleIcon}
                    loading={openDirect.isPending}
                    onPress={() => openDirect.mutate(head.id, { onSuccess: (id) => router.push(`/dm/${id}`), onError: (e) => setError(errorText(e)) })}
                  />
                ) : (
                  <Button label="Add friend" compact icon={UserPlusIcon} onPress={() => router.push("/people")} accessibilityLabel={`Find ${head.name} in Chats to add them as a friend`} />
                )}
              </View>
            )}
            <Divider style={{ alignSelf: "stretch", marginTop: space.lg }} />
            {!head.canSeePosts ? (
              <EmptyState icon={LockSimpleIcon} title="This account is private" body={head.followState === "requested" ? "Your request is waiting for approval." : "Follow them, and once they approve, their posts show here."} />
            ) : q.data && !posts.length ? (
              <EmptyState icon={NoteBlankIcon} title="No posts yet" body={self ? "Your posts show here. Post from Home." : "Nothing to see here yet."} />
            ) : null}
          </View>
        }
        renderItem={({ item }) => <PostCard post={item} />}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={color.accentText} style={{ margin: space.lg }} /> : undefined}
      />
      <ConfirmSheet
        open={confirmUnfollow}
        title={head.followState === "requested" ? "Cancel your request?" : `Unfollow ${head.name}?`}
        body={head.privateAccount ? "Their posts stop showing for you, and you'd need to ask again to follow." : "Their posts stop showing in your Following feed."}
        confirmLabel={head.followState === "requested" ? "Cancel request" : "Unfollow"}
        busy={follow.isPending}
        onConfirm={() => {
          act("unfollow");
          setConfirmUnfollow(false);
        }}
        onClose={() => setConfirmUnfollow(false)}
      />
    </Screen>
  );
}
