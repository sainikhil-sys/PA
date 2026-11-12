import { router, useLocalSearchParams } from "expo-router";
import { CaretLeftIcon, GearSixIcon, MagnifyingGlassIcon, UserPlusIcon } from "phosphor-react-native";
import * as React from "react";
import { FlatList, ScrollView, TextInput, View } from "react-native";
import { Button, EmptyState, ErrorState, IconButton, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { useDebounced } from "@/features/chat/format";
import { useFriendAction, useFriends, useOpenDirect, usePeopleSearch, useSocialProfile } from "@/features/social/api";
import { PersonRow } from "@/features/social/components";
import { JoinChats } from "@/features/social/join";
import type { FoundPerson, Person } from "@/features/social/types";
import { errorText } from "@/lib/api";
import { color, radius, space, TOUCH, type } from "@/theme/tokens";

/** Find people by handle, answer requests, and start chats. */
export default function PeopleScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const profile = useSocialProfile();
  const friends = useFriends(Boolean(profile.data?.profile));
  const [q, setQ] = React.useState("");
  const search = useDebounced(q.trim().replace(/^@+/, ""), 300);
  const results = usePeopleSearch(search.length >= 2 ? search : "");
  const action = useFriendAction();
  const open = useOpenDirect();
  const [error, setError] = React.useState<string | null>(null);

  const act = (p: Person, a: "request" | "accept" | "decline" | "cancel") => {
    setError(null);
    action.mutate({ userId: p.id, action: a }, { onError: (e) => setError(errorText(e)) });
  };
  const message = (p: Person) => {
    setError(null);
    open.mutate(p.id, { onSuccess: (id) => router.push(`/dm/${id}`), onError: (e) => setError(errorText(e)) });
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
      <IconButton icon={CaretLeftIcon} label="Back" tone="plain" onPress={() => (router.canGoBack() ? router.back() : router.replace("/chats"))} />
      <Txt variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
        Find people
      </Txt>
      {profile.data?.profile ? <IconButton icon={GearSixIcon} label="Chats privacy and blocked people" tone="plain" onPress={() => router.push("/people/settings")} /> : null}
    </View>
  );

  if (profile.isPending)
    return (
      <Screen>
        {header}
        <View style={{ padding: space.lg }}>
          <Skeleton rows={4} />
        </View>
      </Screen>
    );
  if (!profile.data?.profile)
    return (
      <Screen>
        {header}
        {profile.isError ? <ErrorState message={errorText(profile.error)} onRetry={() => void profile.refetch()} /> : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg }}>
            <JoinChats suggestion={profile.data?.suggestion} />
          </ScrollView>
        )}
      </Screen>
    );

  const me = profile.data.profile;
  const incoming = friends.data?.incoming ?? [];
  const showRequests = !search && incoming.length > 0;
  const items: FoundPerson[] = search.length >= 2 ? (results.data ?? []) : [];

  return (
    <Screen>
      {header}
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space.lg }}
        ListHeaderComponent={
          <View style={{ gap: space.lg, marginBottom: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface }}>
              <MagnifyingGlassIcon size={18} color={color.subtle} />
              <TextInput
                value={q}
                onChangeText={setQ}
                autoFocus={params.tab !== "requests"}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Search by handle or name"
                placeholderTextColor={color.subtle}
                accessibilityLabel="Search people by handle or name"
                style={[type.body, { flex: 1, minHeight: TOUCH }]}
                selectionColor={color.accentText}
                cursorColor={color.accentText}
              />
            </View>
            <Txt variant="small">{`Your handle is @${me.handle}. Share it so friends can add you.${me.searchable ? "" : " You're hidden from search, so only people you add can find you."}`}</Txt>
            {error ? (
              <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
                {error}
              </Txt>
            ) : null}
            {showRequests ? (
              <View>
                <SectionHeader title="Friend requests" />
                {incoming.map((p) => (
                  <PersonRow
                    key={p.id}
                    person={p}
                    right={
                      <View style={{ flexDirection: "row", gap: space.sm }}>
                        <Button label="Decline" compact variant="ghost" disabled={action.isPending} onPress={() => act(p, "decline")} accessibilityLabel={`Decline ${p.name}`} />
                        <Button label="Accept" compact variant="primary" disabled={action.isPending} onPress={() => act(p, "accept")} accessibilityLabel={`Accept ${p.name}`} />
                      </View>
                    }
                  />
                ))}
              </View>
            ) : null}
            {search.length >= 2 && results.isPending ? <Skeleton rows={3} height={56} /> : null}
            {search.length >= 2 && results.isError ? <ErrorState message={errorText(results.error)} onRetry={() => void results.refetch()} /> : null}
            {search.length >= 2 && results.data && !results.data.length ? <EmptyState icon={MagnifyingGlassIcon} title="Nobody found" body={`No one who allows search matches "${search}". Check the spelling, or ask them for their handle.`} /> : null}
            {!search && !showRequests ? <EmptyState icon={UserPlusIcon} title="Add a friend" body="Type at least two letters of their handle or name." /> : null}
          </View>
        }
        renderItem={({ item }) => <PersonRow person={item} right={<RelationshipButton person={item} busy={action.isPending || open.isPending} onAct={act} onMessage={message} />} />}
      />
    </Screen>
  );
}

function RelationshipButton({ person, busy, onAct, onMessage }: { person: FoundPerson; busy: boolean; onAct: (p: Person, a: "request" | "accept" | "cancel") => void; onMessage: (p: Person) => void }) {
  switch (person.relationship) {
    case "friends":
      return <Button label="Message" compact variant="primary" disabled={busy} onPress={() => onMessage(person)} accessibilityLabel={`Message ${person.name}`} />;
    case "incoming":
      return <Button label="Accept" compact variant="primary" disabled={busy} onPress={() => onAct(person, "accept")} accessibilityLabel={`Accept ${person.name}'s request`} />;
    case "outgoing":
      return <Button label="Requested" compact variant="ghost" disabled={busy} onPress={() => onAct(person, "cancel")} accessibilityLabel={`Cancel request to ${person.name}`} />;
    case "blocked":
      return <Txt variant="small">Blocked</Txt>;
    default:
      return <Button label="Add" compact icon={UserPlusIcon} disabled={busy} onPress={() => onAct(person, "request")} accessibilityLabel={`Send ${person.name} a friend request`} />;
  }
}
