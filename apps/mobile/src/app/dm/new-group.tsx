import { router } from "expo-router";
import { CaretLeftIcon, CheckSquareIcon, SquareIcon, UserPlusIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, KeyboardAvoidingView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, EmptyState, ErrorState, IconButton, Input, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { useCreateGroup, useFriends } from "@/features/social/api";
import { PersonRow } from "@/features/social/components";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

/** New group: a name and at least one friend. */
export default function NewGroupScreen() {
  const insets = useSafeAreaInsets();
  const friends = useFriends();
  const create = useCreateGroup();
  const [title, setTitle] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const list = friends.data?.friends ?? [];

  return (
    <Screen>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
          <IconButton icon={CaretLeftIcon} label="Back" tone="plain" onPress={() => router.back()} />
          <Txt variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
            New group
          </Txt>
        </View>
        <FlatList
          data={friends.isPending || (friends.isError && !friends.data) ? [] : list}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.lg, gap: space.xs }}
          ListHeaderComponent={
            <View style={{ gap: space.lg, marginBottom: space.md }}>
              <Input label="Group name" value={title} onChangeText={setTitle} placeholder="Weekend trip" maxLength={60} />
              <SectionHeader title={picked.size ? `${picked.size} selected` : "Add friends"} />
              {friends.isPending ? <Skeleton rows={4} height={56} /> : null}
              {friends.isError && !friends.data ? <ErrorState message={errorText(friends.error)} onRetry={() => void friends.refetch()} /> : null}
              {friends.data && !list.length ? (
                <EmptyState icon={UserPlusIcon} title="No friends yet" body="Groups are made from your friends. Add people first." action={<Button label="Find people" compact onPress={() => router.replace("/people")} />} />
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const on = picked.has(item.id);
            return (
              <PersonRow
                person={item}
                onPress={() => toggle(item.id)}
                right={<View accessibilityLabel={on ? "Selected" : "Not selected"}>{on ? <CheckSquareIcon size={24} color={color.accentText} weight="fill" /> : <SquareIcon size={24} color={color.subtle} />}</View>}
              />
            );
          }}
        />
        <View style={{ padding: space.lg, paddingBottom: Math.max(insets.bottom, space.lg), borderTopWidth: 1, borderTopColor: color.border, gap: space.sm }}>
          {create.isError ? (
            <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
              {errorText(create.error)}
            </Txt>
          ) : null}
          <Button
            label="Create group"
            variant="primary"
            disabled={!title.trim() || !picked.size}
            loading={create.isPending}
            onPress={() => create.mutate({ title: title.trim(), memberIds: [...picked] }, { onSuccess: (id) => router.replace(`/dm/${id}`) })}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
