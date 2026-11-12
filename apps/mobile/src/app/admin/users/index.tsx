import { router, type Href } from "expo-router";
import { CaretRightIcon, MagnifyingGlassIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, Pressable, View } from "react-native";
import { Button, EmptyState, ErrorState, Input, Skeleton, Txt } from "@/components/ui";
import { useUserSearch, type UserRow } from "@/features/admin/api";
import { AdminScreen, RequirePermission } from "@/features/admin/ui";
import { refresh, timeAgo } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, space } from "@/theme/tokens";

export default function AdminUsers() {
  return (
    <RequirePermission permission="users.read" title="Users">
      <Users />
    </RequirePermission>
  );
}

function UserItem({ u }: { u: UserRow }) {
  const status = u.disabledAt ? "Suspended" : u.lastSeen ? `Seen ${timeAgo(u.lastSeen).toLowerCase()}` : "Not seen yet";
  const restricted = u.restrictions > 0 ? `, ${u.restrictions} restriction${u.restrictions === 1 ? "" : "s"}` : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${u.name || u.email}, ${u.email}. ${status}${restricted}`}
      onPress={() => router.push(`/admin/users/${u.id}` as Href)}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: pressed ? color.surface2 : undefined })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label" numberOfLines={1}>
          {u.name || u.email}
        </Txt>
        <Txt variant="small" numberOfLines={1}>
          {u.name ? u.email : status}
        </Txt>
        {u.name || restricted ? (
          <Txt variant="small" numberOfLines={1} style={u.disabledAt ? { color: color.danger } : undefined}>
            {`${u.name ? status : ""}${restricted}`.replace(/^, /, "")}
          </Txt>
        ) : null}
      </View>
      <CaretRightIcon size={18} color={color.subtle} />
    </Pressable>
  );
}

function Users() {
  const [text, setText] = React.useState("");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const search = useUserSearch(q, page);

  // Search a moment after typing stops, from the first page.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [text]);

  const d = search.data;
  return (
    <AdminScreen title="Users" scroll={false}>
      <View style={{ padding: space.lg, paddingBottom: space.sm }}>
        <Input value={text} onChangeText={setText} placeholder="Search by email or name" accessibilityLabel="Search users by email or name" autoCapitalize="none" autoCorrect={false} returnKeyType="search" inputMode="search" />
      </View>
      {search.isPending ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={5} />
        </View>
      ) : search.isError && !d ? (
        <ErrorState message={errorText(search.error)} onRetry={() => void search.refetch()} />
      ) : (
        <FlatList
          data={d?.rows ?? []}
          keyExtractor={(u) => u.id}
          renderItem={({ item }) => <UserItem u={item} />}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: color.border, marginHorizontal: space.lg }} />}
          refreshControl={refresh(search.isRefetching, () => void search.refetch())}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={d ? <Txt variant="small" style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>{`${d.total.toLocaleString()} account${d.total === 1 ? "" : "s"}`}</Txt> : undefined}
          ListEmptyComponent={<EmptyState icon={MagnifyingGlassIcon} title="No accounts found" body={q ? "Try part of the email address instead." : "No accounts yet."} />}
          ListFooterComponent={
            d && d.pages > 1 ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: space.lg, gap: space.md }}>
                <Button label="Previous" compact disabled={page <= 1 || search.isFetching} onPress={() => setPage((p) => Math.max(1, p - 1))} />
                <Txt variant="small">{`Page ${d.page} of ${d.pages}`}</Txt>
                <Button label="Next" compact disabled={page >= d.pages || search.isFetching} onPress={() => setPage((p) => p + 1)} />
              </View>
            ) : undefined
          }
        />
      )}
    </AdminScreen>
  );
}
