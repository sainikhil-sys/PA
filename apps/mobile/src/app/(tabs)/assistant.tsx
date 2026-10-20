import { router } from "expo-router";
import { CaretRightIcon, ChatCircleIcon, MagnifyingGlassIcon, MicrophoneIcon, PlusIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, Pressable, RefreshControl, TextInput, View } from "react-native";
import { Button, Divider, EmptyState, ErrorState, Screen, Skeleton, Txt } from "@/components/ui";
import { updatedLabel, useDebounced } from "@/features/chat/format";
import { errorText } from "@/lib/api";
import { useConversations } from "@/lib/queries";
import type { Conversation } from "@/lib/types";
import { color, radius, space, TOUCH, type } from "@/theme/tokens";

/** Assistant: every chat, newest first, with search across titles and message text. */
export default function AssistantScreen() {
  const [q, setQ] = React.useState("");
  const search = useDebounced(q.trim(), 300);
  const list = useConversations(search);
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  }, [list]);

  const items = list.data ?? [];
  const typing = q.trim() !== search;

  let body: React.ReactNode = null;
  if (list.isPending) body = <Skeleton rows={5} height={60} />;
  else if (list.isError && !list.data) body = <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />;
  else if (!items.length && search)
    body = (
      <EmptyState
        icon={MagnifyingGlassIcon}
        title="No matches"
        body={`No chat title or message contains "${search}".`}
        action={<Button label="Clear search" compact icon={XIcon} onPress={() => setQ("")} />}
      />
    );
  else if (!items.length)
    body = (
      <EmptyState
        icon={ChatCircleIcon}
        title="No chats yet"
        body="Ask about your email, calendar, tasks or documents, or anything else."
        action={<Button label="Speak instead" compact icon={MicrophoneIcon} onPress={() => router.push("/chat/new?voice=1")} />}
      />
    );

  return (
    <Screen>
      <FlatList
        data={body ? [] : items}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.orange} colors={[color.orange]} progressBackgroundColor={color.surface2} />}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.md }}>
            <Txt variant="display" accessibilityRole="header">
              Assistant
            </Txt>
            <Button label="New chat" variant="primary" icon={PlusIcon} onPress={() => router.push("/chat/new")} />
            <SearchBox value={q} onChange={setQ} busy={typing || (list.isFetching && !refreshing)} />
            {list.isError && list.data ? (
              <Txt variant="small" accessibilityLiveRegion="polite">
                Couldn't refresh. {errorText(list.error)}
              </Txt>
            ) : null}
            {body}
          </View>
        }
        ItemSeparatorComponent={() => <Divider />}
        renderItem={({ item }) => <ConversationRow convo={item} />}
      />
    </Screen>
  );
}

function SearchBox({ value, onChange, busy }: { value: string; onChange: (t: string) => void; busy: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: TOUCH + 4, borderRadius: radius.control, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.surface, paddingLeft: space.md }}>
      <MagnifyingGlassIcon size={18} color={color.subtle} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search chats"
        placeholderTextColor={color.subtle}
        selectionColor={color.orange}
        cursorColor={color.orange}
        accessibilityLabel="Search chats"
        accessibilityHint={busy ? "Searching" : undefined}
        returnKeyType="search"
        autoCorrect={false}
        maxLength={100}
        maxFontSizeMultiplier={1.6}
        style={[type.body, { flex: 1, minHeight: TOUCH, paddingHorizontal: space.sm, fontSize: 16 }]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChange("")} style={{ width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" }}>
          <XIcon size={18} color={color.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ConversationRow({ convo }: { convo: Conversation }) {
  const when = updatedLabel(convo.updatedAt);
  const title = convo.title?.trim() || "Untitled chat";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, updated ${when}`}
      onPress={() => router.push(`/chat/${convo.id}`)}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64, paddingVertical: space.sm, backgroundColor: pressed ? color.surface : "transparent" })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label" numberOfLines={1}>
          {title}
        </Txt>
        <Txt variant="small">{when}</Txt>
      </View>
      <CaretRightIcon size={16} color={color.subtle} />
    </Pressable>
  );
}
