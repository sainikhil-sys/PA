import { router } from "expo-router";
import { CaretLeftIcon, ProhibitIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, View } from "react-native";
import { Button, EmptyState, ErrorState, IconButton, Input, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { useBlock, useBlocked, useSaveProfile, useSocialProfile } from "@/features/social/api";
import { handleHint, SwitchRow } from "@/features/social/join";
import { errorText } from "@/lib/api";
import { color, radius, space } from "@/theme/tokens";

/** Chats profile and privacy: handle, name, who can find you, presence, read receipts, previews, blocked people. */
export default function ChatsSettings() {
  const profile = useSocialProfile();
  const save = useSaveProfile();
  const blocked = useBlocked();
  const unblock = useBlock();
  const p = profile.data?.profile;

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
        <IconButton icon={CaretLeftIcon} label="Back" tone="plain" onPress={() => router.back()} />
        <Txt variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
          Chats privacy
        </Txt>
      </View>
      {profile.isPending ? (
        <View style={{ padding: space.lg }}>
          <Skeleton rows={5} />
        </View>
      ) : !p ? (
        <ErrorState message={profile.isError ? errorText(profile.error) : "Set up Chats first."} onRetry={() => void profile.refetch()} />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
          {/* Keyed on the saved values, so the form starts over from them after each save. */}
          <ProfileForm key={`${p.handle}|${p.displayName}`} handle={p.handle} displayName={p.displayName} />

          <View style={{ gap: space.xs }}>
            <SectionHeader title="Privacy" />
            <SwitchRow title="Let people find me by handle" detail="Off: only people you add, or who already know your handle through you, can find you." value={p.searchable} disabled={save.isPending} onChange={(v) => save.mutate({ searchable: v })} />
            <SwitchRow title="Show when I'm active" detail="Friends see Active now while Cowork is open. Off: they never see it." value={p.showPresence} disabled={save.isPending} onChange={(v) => save.mutate({ showPresence: v })} />
            <SwitchRow title="Read receipts" detail="Off: others don't see when you've read their messages, and you don't see theirs." value={p.readReceipts} disabled={save.isPending} onChange={(v) => save.mutate({ readReceipts: v })} />
            <SwitchRow title="Show message text in notifications" detail="Off: notifications only say who wrote, so nothing private shows on the lock screen." value={p.pushPreview} disabled={save.isPending} onChange={(v) => save.mutate({ pushPreview: v })} />
          </View>
          {save.isError ? (
            <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
              {errorText(save.error)}
            </Txt>
          ) : null}

          <View>
            <SectionHeader title="Blocked people" />
            {blocked.isPending ? <Skeleton rows={2} height={48} /> : null}
            {blocked.data && !blocked.data.length ? <EmptyState icon={ProhibitIcon} title="Nobody blocked" body="People you block can't find you, message you or send requests." /> : null}
            {blocked.data?.length ? (
              <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, paddingHorizontal: space.lg }}>
                {blocked.data.map((b) => (
                  <View key={b.id} style={{ flexDirection: "row", alignItems: "center", minHeight: 56, gap: space.md }}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="label">{b.name}</Txt>
                      {b.handle ? <Txt variant="small">{`@${b.handle}`}</Txt> : null}
                    </View>
                    <Button label="Unblock" compact variant="ghost" disabled={unblock.isPending} onPress={() => unblock.mutate({ userId: b.id, blocked: false })} accessibilityLabel={`Unblock ${b.name}`} />
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <Txt variant="small">{"Messages in Chats are sent over an encrypted connection and stored on Cowork's servers. They are not end-to-end encrypted. Your assistant does not read them."}</Txt>
        </ScrollView>
      )}
    </Screen>
  );
}

function ProfileForm({ handle: savedHandle, displayName }: { handle: string; displayName: string }) {
  const save = useSaveProfile();
  const [handle, setHandle] = React.useState(savedHandle);
  const [name, setName] = React.useState(displayName);
  const hint = handleHint(handle);
  const dirty = handle.trim().toLowerCase() !== savedHandle || name.trim() !== displayName;
  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title="Profile" />
      <Input label="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} error={hint} maxLength={25} />
      <Input label="Name people see" value={name} onChangeText={setName} maxLength={60} />
      {save.isError ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {errorText(save.error)}
        </Txt>
      ) : null}
      {dirty ? <Button label="Save profile" variant="primary" disabled={Boolean(hint) || !name.trim()} loading={save.isPending} onPress={() => save.mutate({ handle: handle.trim(), displayName: name.trim() })} /> : null}
    </View>
  );
}
