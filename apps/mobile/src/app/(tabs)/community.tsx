import { router } from "expo-router";
import { CaretRightIcon, GlobeHemisphereWestIcon, LockSimpleIcon, MagnifyingGlassIcon, PlusIcon, UsersThreeIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { Button, Divider, EmptyState, ErrorState, IconButton, Screen, Skeleton, Txt } from "@/components/ui";
import { useDebounced } from "@/features/chat/format";
import { useTabBarSpace } from "@/features/navigation/tab-bar";
import { Segments } from "@/features/social/components";
import { spacesMissing, useDiscoverSpaces, useMySpaces } from "@/features/spaces/api";
import { CATEGORY_LABEL, SPACE_CATEGORIES, type Space, type SpaceCategory } from "@/features/spaces/types";
import { errorText } from "@/lib/api";
import { color, radius, space, TOUCH, type } from "@/theme/tokens";

type Tab = "mine" | "discover";

const MISSING = "Community isn't available on the Cowork server yet. It appears here as soon as the update is live.";

/** Community: the Spaces you're in, and public Spaces to discover. */
export default function CommunityTab() {
  const bottom = useTabBarSpace();
  const [tab, setTab] = React.useState<Tab>("mine");
  const [q, setQ] = React.useState("");
  const [category, setCategory] = React.useState<SpaceCategory | "">("");
  const search = useDebounced(q.trim(), 300);
  const mine = useMySpaces();
  const discover = useDiscoverSpaces(search, category);
  const [refreshing, setRefreshing] = React.useState(false);

  const missing = spacesMissing(mine.error) || spacesMissing(discover.error);
  const list: Space[] = tab === "mine" ? (mine.data ?? []) : (discover.data?.pages ?? []).flatMap((p) => p.items);
  const loading = tab === "mine" ? mine.isPending : discover.isPending;
  const failed = tab === "mine" ? mine.isError && !mine.data : discover.isError && !discover.data;
  const err = tab === "mine" ? mine.error : discover.error;

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.sm }}>
        <Txt variant="display" accessibilityRole="header" style={{ flex: 1 }}>
          Community
        </Txt>
        {!missing ? <IconButton icon={PlusIcon} label="Create a Space" tone="plain" onPress={() => router.push("/space/new")} /> : null}
      </View>
      <FlatList
        data={missing || failed || loading ? [] : list}
        keyExtractor={(s) => s.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: bottom }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([mine.refetch(), discover.refetch()]);
              setRefreshing(false);
            }}
            tintColor={color.accentText}
            colors={[color.accentText]}
            progressBackgroundColor={color.surface2}
          />
        }
        onEndReached={() => {
          if (tab === "discover" && discover.hasNextPage && !discover.isFetchingNextPage) void discover.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.sm }}>
            <Txt variant="small">Spaces are communities: posts, polls, events and members, for your university, interests or local area.</Txt>
            {missing ? (
              <EmptyState icon={UsersThreeIcon} title="Not available yet" body={MISSING} />
            ) : (
              <>
                <Segments<Tab>
                  value={tab}
                  onChange={setTab}
                  options={[
                    { key: "mine", label: "Your Spaces" },
                    { key: "discover", label: "Discover" },
                  ]}
                />
                {tab === "discover" ? (
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface }}>
                      <MagnifyingGlassIcon size={18} color={color.subtle} />
                      <TextInput
                        value={q}
                        onChangeText={setQ}
                        placeholder="Search Spaces"
                        placeholderTextColor={color.subtle}
                        accessibilityLabel="Search Spaces"
                        returnKeyType="search"
                        style={[type.body, { flex: 1, minHeight: TOUCH }]}
                        selectionColor={color.accentText}
                        cursorColor={color.accentText}
                      />
                      {q ? <IconButton icon={XIcon} label="Clear search" tone="plain" size={36} onPress={() => setQ("")} /> : null}
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
                      {(["", ...SPACE_CATEGORIES] as const).map((c) => {
                        const on = category === c;
                        return (
                          <Pressable
                            key={c || "all"}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            onPress={() => setCategory(c)}
                            style={({ pressed }) => ({ minHeight: 36, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: on ? color.accent : color.border, backgroundColor: on ? color.accent : pressed ? color.surface2 : color.surface })}
                          >
                            <Txt variant="label" style={{ color: on ? color.onAccent : color.text }}>
                              {c ? CATEGORY_LABEL[c] : "All"}
                            </Txt>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </>
                ) : null}
                {loading ? <Skeleton rows={4} height={64} /> : null}
                {failed ? <ErrorState message={errorText(err)} onRetry={() => void (tab === "mine" ? mine.refetch() : discover.refetch())} /> : null}
                {!loading && !failed && !list.length ? (
                  tab === "mine" ? (
                    <EmptyState
                      icon={UsersThreeIcon}
                      title="You're not in any Spaces yet"
                      body="Find one to join, or start your own for a class, a club or your neighbourhood."
                      action={
                        <View style={{ flexDirection: "row", gap: space.sm }}>
                          <Button label="Discover" compact onPress={() => setTab("discover")} />
                          <Button label="Create a Space" variant="primary" compact icon={PlusIcon} onPress={() => router.push("/space/new")} />
                        </View>
                      }
                    />
                  ) : (
                    <EmptyState icon={MagnifyingGlassIcon} title="No Spaces found" body={search || category ? "Try another word or category." : "Public Spaces appear here."} />
                  )
                ) : null}
              </>
            )}
          </View>
        }
        ItemSeparatorComponent={() => <Divider />}
        renderItem={({ item }) => <SpaceRow s={item} />}
        ListFooterComponent={discover.isFetchingNextPage ? <ActivityIndicator color={color.accentText} style={{ margin: space.lg }} /> : undefined}
      />
    </Screen>
  );
}

function SpaceRow({ s }: { s: Space }) {
  const status = s.myStatus === "requested" ? "Request sent" : s.myRole ? (s.myRole === "member" ? "Member" : s.myRole === "owner" ? "Owner" : "Moderator") : null;
  const VisIcon = s.visibility === "private" ? LockSimpleIcon : GlobeHemisphereWestIcon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${s.name}, ${s.memberCount} members${status ? `, ${status}` : ""}`}
      onPress={() => router.push(`/space/${encodeURIComponent(s.slug)}`)}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, minHeight: 72, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ width: 48, height: 48, borderRadius: radius.card, alignItems: "center", justifyContent: "center", backgroundColor: color.surface2 }}>
        <Txt variant="heading" style={{ color: color.accentText }}>
          {s.name.trim().charAt(0).toUpperCase()}
        </Txt>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Txt variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
            {s.name}
          </Txt>
          <VisIcon size={13} color={color.subtle} />
        </View>
        <Txt variant="small" numberOfLines={1}>
          {[`${s.memberCount} ${s.memberCount === 1 ? "member" : "members"}`, s.category ? CATEGORY_LABEL[s.category] : null, status].filter(Boolean).join("  ·  ")}
        </Txt>
        {s.description ? (
          <Txt variant="small" numberOfLines={1}>
            {s.description}
          </Txt>
        ) : null}
      </View>
      <CaretRightIcon size={18} color={color.subtle} />
    </Pressable>
  );
}
