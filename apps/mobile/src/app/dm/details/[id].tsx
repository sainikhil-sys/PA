import { router, useLocalSearchParams } from "expo-router";
import { BellIcon, BellSlashIcon, CaretLeftIcon, FlagIcon, ProhibitIcon, SignOutIcon, UserMinusIcon, UserPlusIcon, XIcon, PencilSimpleIcon } from "phosphor-react-native";
import * as React from "react";
import { ScrollView, View } from "react-native";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, Divider, ErrorState, IconButton, Input, Row, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { useBlock, useFriendAction, useFriends, useThread, useUpdateThread } from "@/features/social/api";
import { PersonAvatar, PersonRow } from "@/features/social/components";
import { ReportSheet } from "@/features/social/report-sheet";
import { errorText } from "@/lib/api";
import { color, radius, space } from "@/theme/tokens";

type Confirm = { kind: "leave" } | { kind: "block"; userId: string; name: string } | { kind: "unblock"; userId: string; name: string } | { kind: "unfriend"; userId: string; name: string } | { kind: "remove"; userId: string; name: string };

/** Chat details: people, mute, rename and membership (groups), block, report, leave. */
export default function ChatDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useThread(id);
  const update = useUpdateThread(id);
  const block = useBlock();
  const friendAction = useFriendAction();
  const friends = useFriends();
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [rename, setRename] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [report, setReport] = React.useState<{ userId?: string; threadId?: string; label: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const head = q.data?.pages[0];
  const t = head?.thread;
  const manager = t?.myRole === "owner" || t?.myRole === "admin";
  const other = t?.other ?? null;

  const run = (p: Promise<unknown>, after?: () => void) => {
    setError(null);
    p.then(() => after?.()).catch((e: unknown) => setError(errorText(e)));
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
      <IconButton icon={CaretLeftIcon} label="Back" tone="plain" onPress={() => router.back()} />
      <Txt variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
        {t?.kind === "group" ? "Group details" : "Chat details"}
      </Txt>
    </View>
  );

  if (q.isPending)
    return (
      <Screen>
        {header}
        <View style={{ padding: space.lg }}>
          <Skeleton rows={5} />
        </View>
      </Screen>
    );
  if (!t)
    return (
      <Screen>
        {header}
        <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
      </Screen>
    );

  const memberIds = new Set(t.members.map((m) => m.id));
  const addable = (friends.data?.friends ?? []).filter((f) => !memberIds.has(f.id));

  return (
    <Screen>
      {header}
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <View style={{ alignItems: "center", gap: space.sm }}>
          <PersonAvatar name={t.title} url={other?.avatarUrl} size={80} group={t.kind === "group"} online={other?.online} />
          <Txt variant="title" style={{ textAlign: "center" }}>
            {t.title}
          </Txt>
          <Txt variant="small">{t.kind === "group" ? `${t.members.length} people` : other ? `@${other.handle}${other.online ? "  ·  Active now" : ""}` : ""}</Txt>
        </View>

        {error ? (
          <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
            {error}
          </Txt>
        ) : null}

        <Group>
          <Row icon={t.muted ? BellIcon : BellSlashIcon} title={t.muted ? "Unmute notifications" : "Mute notifications"} detail={t.muted ? "You don't get notifications for this chat." : undefined} onPress={() => run(update.mutateAsync({ mute: !t.muted }))} />
          {t.kind === "group" && manager ? <Row icon={PencilSimpleIcon} title="Rename group" onPress={() => setRename(t.title)} /> : null}
        </Group>

        {t.kind === "group" ? (
          <View>
            <SectionHeader title="People" action={manager && addable.length ? <Button label="Add" compact variant="ghost" icon={UserPlusIcon} onPress={() => setAdding(true)} /> : undefined} />
            {t.members.map((m) => (
              <PersonRow
                key={m.id}
                person={m}
                detail={`@${m.handle}${m.role !== "member" ? `  ·  ${m.role === "owner" ? "Owner" : "Admin"}` : ""}`}
                right={manager && m.role === "member" && m.id !== head?.me ? <IconButton icon={XIcon} label={`Remove ${m.name}`} tone="plain" onPress={() => setConfirm({ kind: "remove", userId: m.id, name: m.name })} /> : undefined}
              />
            ))}
          </View>
        ) : null}

        <Group>
          {t.kind === "direct" && other ? (
            <>
              {t.relationship === "friends" ? <Row icon={UserMinusIcon} title="Remove friend" onPress={() => setConfirm({ kind: "unfriend", userId: other.id, name: other.name })} /> : null}
              {t.relationship === "blocked" ? (
                <Row icon={ProhibitIcon} title={`Unblock ${other.name}`} onPress={() => setConfirm({ kind: "unblock", userId: other.id, name: other.name })} />
              ) : (
                <Row icon={ProhibitIcon} title={`Block ${other.name}`} danger onPress={() => setConfirm({ kind: "block", userId: other.id, name: other.name })} />
              )}
              <Row icon={FlagIcon} title={`Report ${other.name}`} danger onPress={() => setReport({ userId: other.id, threadId: id, label: other.name })} />
            </>
          ) : (
            <>
              <Row icon={FlagIcon} title="Report group" danger onPress={() => setReport({ threadId: id, label: "this group" })} />
              <Row icon={SignOutIcon} title="Leave group" danger onPress={() => setConfirm({ kind: "leave" })} />
            </>
          )}
        </Group>
      </ScrollView>

      <ConfirmSheet
        open={Boolean(confirm)}
        title={
          confirm?.kind === "leave"
            ? "Leave this group?"
            : confirm?.kind === "block"
              ? `Block ${confirm.name}?`
              : confirm?.kind === "unblock"
                ? `Unblock ${confirm.name}?`
                : confirm?.kind === "unfriend"
                  ? `Remove ${confirm.name} as a friend?`
                  : confirm?.kind === "remove"
                    ? `Remove ${confirm.name}?`
                    : ""
        }
        body={
          confirm?.kind === "leave"
            ? "You stop getting messages from this group. Someone in it has to add you back to rejoin."
            : confirm?.kind === "block"
              ? "They can't message you, find you or send you requests, and your friendship ends. They aren't told."
              : confirm?.kind === "unblock"
                ? "They can find you again and send you a friend request. Your old friendship isn't restored."
                : confirm?.kind === "unfriend"
                  ? "You can still see this chat's history, but you'll need to be friends again to start new direct chats."
                  : "They stop getting messages from this group."
        }
        confirmLabel={confirm?.kind === "leave" ? "Leave group" : confirm?.kind === "block" ? "Block" : confirm?.kind === "unblock" ? "Unblock" : "Remove"}
        destructive={confirm?.kind !== "unblock"}
        busy={update.isPending || block.isPending || friendAction.isPending}
        onConfirm={() => {
          const c = confirm;
          if (!c) return;
          if (c.kind === "leave") run(update.mutateAsync({ leave: true }), () => router.replace("/chats"));
          else if (c.kind === "block") run(block.mutateAsync({ userId: c.userId, blocked: true }), () => void q.refetch());
          else if (c.kind === "unblock") run(block.mutateAsync({ userId: c.userId, blocked: false }), () => void q.refetch());
          else if (c.kind === "unfriend") run(friendAction.mutateAsync({ userId: c.userId, action: "remove" }), () => void q.refetch());
          else if (c.kind === "remove") run(update.mutateAsync({ remove: c.userId }));
          setConfirm(null);
        }}
        onClose={() => setConfirm(null)}
      />

      <Sheet open={rename !== null} onClose={() => setRename(null)} title="Rename group">
        <Input value={rename ?? ""} onChangeText={setRename} maxLength={60} autoFocus accessibilityLabel="Group name" />
        <Button label="Save" variant="primary" disabled={!rename?.trim()} loading={update.isPending} onPress={() => run(update.mutateAsync({ title: rename?.trim() ?? "" }), () => setRename(null))} />
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add people">
        <ScrollView style={{ maxHeight: 360 }}>
          {addable.map((p) => (
            <PersonRow key={p.id} person={p} right={<Button label="Add" compact disabled={update.isPending} onPress={() => run(update.mutateAsync({ add: [p.id] }))} accessibilityLabel={`Add ${p.name}`} />} />
          ))}
        </ScrollView>
        <Button label="Done" variant="ghost" onPress={() => setAdding(false)} />
      </Sheet>

      <ReportSheet target={report} onClose={() => setReport(null)} />
    </Screen>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border, overflow: "hidden" }}>
      {items.map((c, i) => (
        <View key={i}>
          {i > 0 ? <Divider style={{ marginLeft: 52 }} /> : null}
          {c}
        </View>
      ))}
    </View>
  );
}
