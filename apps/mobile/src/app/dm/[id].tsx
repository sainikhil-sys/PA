import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowBendUpLeftIcon, CaretLeftIcon, CopyIcon, FlagIcon, InfoIcon, PaperPlaneRightIcon, PencilSimpleIcon, TrashIcon, ArrowClockwiseIcon, ChatsCircleIcon } from "phosphor-react-native";
import * as React from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, EmptyState, ErrorState, IconButton, Row, Screen, Skeleton, Txt } from "@/components/ui";
import { postReadState, useMessageActions, useThread } from "@/features/social/api";
import { Bubble, PersonAvatar, REACTION_ICON, ReplyPreview, type BubbleItem } from "@/features/social/components";
import { useOutbox, type Pending } from "@/features/social/outbox";
import { ReportSheet } from "@/features/social/report-sheet";
import { REACTIONS, type DmMessage, type ReactionKind } from "@/features/social/types";
import { errorText } from "@/lib/api";
import { color, radius, space, TOUCH, type } from "@/theme/tokens";
import { feedback } from "@/lib/feedback";

const EDIT_WINDOW_MS = 24 * 60 * 60_000;
const TYPING_EVERY_MS = 4_000;

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/** A person-to-person chat. New messages, edits, reactions and read marks refresh every few seconds while open. */
export default function DmScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const q = useThread(id);
  const actions = useMessageActions(id);
  const outbox = useOutbox((s) => s.items);
  const enqueue = useOutbox((s) => s.enqueue);
  const retry = useOutbox((s) => s.retry);
  const discard = useOutbox((s) => s.discard);

  const [text, setText] = React.useState("");
  const [replyTo, setReplyTo] = React.useState<{ id: string; senderName: string; body: string } | null>(null);
  const [editing, setEditing] = React.useState<DmMessage | null>(null);
  const [menu, setMenu] = React.useState<BubbleItem | null>(null);
  // Decided when the menu opens (edits are allowed for 24 hours after sending).
  const [menuEditable, setMenuEditable] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<DmMessage | null>(null);
  const [reportTarget, setReportTarget] = React.useState<{ messageId: string; label: string } | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const lastTyping = React.useRef(0);
  const lastRead = React.useRef(0);
  const input = React.useRef<React.ComponentRef<typeof TextInput>>(null);

  const pages = React.useMemo(() => q.data?.pages ?? [], [q.data]);
  const head = pages[0];
  const thread = head?.thread;
  const myId = head?.me ?? null;

  // Oldest to newest, without duplicates across pages.
  const messages = React.useMemo(() => {
    const seen = new Set<string>();
    const out: DmMessage[] = [];
    for (const page of [...pages].reverse()) {
      for (const m of page.messages) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
      }
    }
    return out.sort((a, b) => a.seq - b.seq);
  }, [pages]);

  const names = React.useMemo(() => new Map((thread?.members ?? []).map((m) => [m.id, m.name])), [thread?.members]);
  const confirmedClientIds = React.useMemo(() => new Set(messages.map((m) => m.clientId)), [messages]);
  const pending = outbox.filter((p) => p.threadId === id && !confirmedClientIds.has(p.clientId));

  // Newest first for the inverted list, with a day label above each day's first message.
  const items = React.useMemo(() => {
    const asc: BubbleItem[] = [];
    let lastDay = "";
    let lastSender: string | null | undefined;
    for (const m of messages) {
      const day = new Date(m.createdAt).toDateString();
      if (day !== lastDay) {
        asc.push({ type: "day", key: `day-${day}`, label: dayLabel(m.createdAt) });
        lastDay = day;
        lastSender = undefined;
      }
      const mine = m.senderId === myId;
      asc.push({ type: "message", key: m.id, message: m, mine, senderName: m.senderId ? (names.get(m.senderId) ?? "Former member") : null, showName: thread?.kind === "group" && !mine && m.senderId !== lastSender });
      lastSender = m.kind === "system" ? undefined : m.senderId;
    }
    for (const p of pending) asc.push({ type: "pending", key: p.clientId, pending: p });
    return asc.reverse();
  }, [messages, pending, myId, names, thread?.kind]);

  // Read marks: everything on screen from other people.
  const newestOther = messages.reduce((n, m) => (m.senderId !== myId ? Math.max(n, m.seq) : n), 0);
  React.useEffect(() => {
    if (!thread || newestOther <= Math.max(thread.readSeq, lastRead.current)) return;
    lastRead.current = newestOther;
    postReadState(id, { seq: newestOther });
  }, [id, thread, newestOther]);

  const onChange = (v: string) => {
    setText(v);
    const now = Date.now();
    if (v.trim() && !editing && now - lastTyping.current > TYPING_EVERY_MS) {
      lastTyping.current = now;
      postReadState(id, { typing: true });
    }
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    feedback.selection();
    if (editing) {
      const target = editing;
      setActionError(null);
      actions.edit.mutate({ id: target.id, body }, { onError: (e) => setActionError(errorText(e)) });
      setEditing(null);
      setText("");
      return;
    }
    enqueue(id, body, replyTo);
    lastTyping.current = 0;
    setReplyTo(null);
    setText("");
  };

  const react = (m: DmMessage, kind: ReactionKind) => {
    setActionError(null);
    feedback.selection();
    actions.react.mutate({ id: m.id, kind }, { onError: (e) => setActionError(errorText(e)) });
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
      <IconButton icon={CaretLeftIcon} label="Back" tone="plain" onPress={() => (router.canGoBack() ? router.back() : router.replace("/chats"))} />
      {thread ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${thread.title}. Chat details`} onPress={() => router.push(`/dm/details/${id}`)} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH }}>
          <PersonAvatar name={thread.title} url={thread.other?.avatarUrl} size={36} online={thread.other?.online} group={thread.kind === "group"} />
          <View style={{ flex: 1 }}>
            <Txt variant="heading" numberOfLines={1} accessibilityRole="header">
              {thread.title}
            </Txt>
            <Txt variant="small" numberOfLines={1} style={{ fontSize: 12, color: head?.typing.length ? color.accentText : color.muted }}>
              {head?.typing.length
                ? thread.kind === "direct"
                  ? "Typing..."
                  : `${head.typing.join(", ")} ${head.typing.length === 1 ? "is" : "are"} typing...`
                : thread.kind === "group"
                  ? `${thread.members.length} people`
                  : thread.other?.online
                    ? "Active now"
                    : thread.other
                      ? `@${thread.other.handle}`
                      : ""}
            </Txt>
          </View>
        </Pressable>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {thread ? <IconButton icon={InfoIcon} label="Chat details" tone="plain" onPress={() => router.push(`/dm/details/${id}`)} /> : null}
    </View>
  );

  if (q.isPending) {
    return (
      <Screen>
        {header}
        <View style={{ padding: space.lg }}>
          <Skeleton rows={6} height={44} />
        </View>
      </Screen>
    );
  }
  if (q.isError && !q.data) {
    return (
      <Screen>
        {header}
        <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }

  const menuMessage = menu?.type === "message" ? menu.message : null;
  const menuPending = menu?.type === "pending" ? menu.pending : null;
  const canEdit = menuEditable;

  return (
    <Screen edges={["top"]}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {header}
        <FlatList
          inverted
          data={items}
          keyExtractor={(it) => it.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ paddingVertical: space.md, gap: space.xs }}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={color.accentText} style={{ margin: space.md }} /> : undefined}
          ListEmptyComponent={
            <View style={{ transform: [{ scaleY: -1 }] }}>
              <EmptyState icon={ChatsCircleIcon} title={thread?.kind === "group" ? "No messages yet" : `Say hello to ${thread?.title ?? "your friend"}`} body="Messages here are only between the people in this chat. Your assistant can't read them." />
            </View>
          }
          renderItem={({ item }) => (
            <Bubble
              item={item}
              onLongPress={item.type === "day" || (item.type === "message" && (item.message.kind === "system" || (item.message.deleted && !item.mine))) ? undefined
                  : () => {
                      setMenuEditable(item.type === "message" && item.mine && !item.message.deleted && Date.now() - Date.parse(item.message.createdAt) < EDIT_WINDOW_MS);
                      setMenu(item);
                    }
              }
              onPressReaction={item.type === "message" ? (kind) => react(item.message, kind) : undefined}
              onRetry={item.type === "pending" ? () => retry(item.pending.clientId) : undefined}
            />
          )}
        />

        {actionError ? (
          <Txt variant="small" style={{ color: color.danger, paddingHorizontal: space.lg, paddingVertical: space.xs }} accessibilityLiveRegion="polite">
            {actionError}
          </Txt>
        ) : null}

        <View style={{ paddingBottom: insets.bottom, backgroundColor: color.bg }}>
          {thread && !thread.canSend ? (
            <View style={{ padding: space.lg, borderTopWidth: 1, borderTopColor: color.border, gap: space.sm }}>
              <Txt variant="small" style={{ textAlign: "center" }}>
                {thread.relationship === "blocked"
                  ? "You blocked this person. Unblock them in chat details to send messages."
                  : thread.relationship === "none" || thread.relationship === "outgoing" || thread.relationship === "incoming"
                    ? "You're not friends anymore. Add them again from Find people to send messages."
                    : "You can't send messages in this chat."}
              </Txt>
            </View>
          ) : (
            <>
              {replyTo ? <ReplyPreview name={replyTo.senderName} body={replyTo.body} onCancel={() => setReplyTo(null)} /> : null}
              {editing ? (
                <ReplyPreview
                  editing
                  name=""
                  body={editing.body}
                  onCancel={() => {
                    setEditing(null);
                    setText("");
                  }}
                />
              ) : null}
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderTopWidth: replyTo || editing ? 0 : 1, borderTopColor: color.border }}>
                <TextInput
                  ref={input}
                  value={text}
                  onChangeText={onChange}
                  placeholder="Message"
                  placeholderTextColor={color.subtle}
                  accessibilityLabel="Message"
                  multiline
                  maxLength={4000}
                  selectionColor={color.accentText}
                  cursorColor={color.accentText}
                  style={[type.body, { flex: 1, minHeight: TOUCH, maxHeight: 140, paddingHorizontal: space.md, paddingTop: 13, paddingBottom: 13, borderRadius: radius.control, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface }]}
                />
                <IconButton icon={editing ? PencilSimpleIcon : PaperPlaneRightIcon} label={editing ? "Save edit" : "Send"} tone="accent" disabled={!text.trim()} onPress={send} />
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      <Sheet open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menuMessage && !menuMessage.deleted ? (
          <View accessibilityLabel="Reactions" style={{ flexDirection: "row", justifyContent: "space-between" }}>
            {REACTIONS.map((k) => {
              const R = REACTION_ICON[k];
              const mine = menuMessage.reactions.some((r) => r.kind === k && r.mine);
              return (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={mine ? `Remove ${R.label}` : R.label}
                  accessibilityState={{ selected: mine }}
                  onPress={() => {
                    react(menuMessage, k);
                    setMenu(null);
                  }}
                  style={({ pressed }) => ({ width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", borderRadius: radius.control, borderWidth: 1, borderColor: mine ? color.accent : color.border, backgroundColor: pressed ? color.surface2 : color.bg })}
                >
                  <R.icon size={22} color={mine ? color.accentText : color.text} weight={mine ? "fill" : "regular"} />
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={{ marginHorizontal: -space.xl }}>
          {menuMessage && !menuMessage.deleted && thread?.canSend ? (
            <Row
              icon={ArrowBendUpLeftIcon}
              title="Reply"
              onPress={() => {
                setReplyTo({ id: menuMessage.id, senderName: menu?.type === "message" && menu.mine ? "yourself" : ((menuMessage.senderId && names.get(menuMessage.senderId)) ?? "Someone"), body: menuMessage.body.slice(0, 160) });
                setEditing(null);
                setMenu(null);
                setTimeout(() => input.current?.focus(), 250);
              }}
            />
          ) : null}
          {menuMessage && !menuMessage.deleted ? (
            <Row
              icon={CopyIcon}
              title="Copy text"
              onPress={() => {
                void Clipboard.setStringAsync(menuMessage.body);
                setMenu(null);
              }}
            />
          ) : null}
          {canEdit && menuMessage ? (
            <Row
              icon={PencilSimpleIcon}
              title="Edit"
              onPress={() => {
                setEditing(menuMessage);
                setReplyTo(null);
                setText(menuMessage.body);
                setMenu(null);
                setTimeout(() => input.current?.focus(), 250);
              }}
            />
          ) : null}
          {menuMessage && menu?.type === "message" && menu.mine && !menuMessage.deleted ? (
            <Row
              icon={TrashIcon}
              title="Delete for everyone"
              danger
              onPress={() => {
                setConfirmDelete(menuMessage);
                setMenu(null);
              }}
            />
          ) : null}
          {menuMessage && menu?.type === "message" && !menu.mine ? (
            <Row
              icon={FlagIcon}
              title="Report message"
              onPress={() => {
                setReportTarget({ messageId: menuMessage.id, label: "message" });
                setMenu(null);
              }}
            />
          ) : null}
          {menuPending ? <PendingActions pending={menuPending} onRetry={() => retry(menuPending.clientId)} onDiscard={() => discard(menuPending.clientId)} onDone={() => setMenu(null)} /> : null}
        </View>
      </Sheet>

      <ConfirmSheet
        open={Boolean(confirmDelete)}
        title="Delete this message?"
        body="It is removed for everyone in this chat. People see that a message was deleted."
        confirmLabel="Delete for everyone"
        destructive
        busy={actions.remove.isPending}
        onConfirm={() => {
          if (!confirmDelete) return;
          setActionError(null);
          actions.remove.mutate(confirmDelete.id, { onError: (e) => setActionError(errorText(e)), onSettled: () => setConfirmDelete(null) });
        }}
        onClose={() => setConfirmDelete(null)}
      />
      <ReportSheet target={reportTarget} onClose={() => setReportTarget(null)} />
    </Screen>
  );
}

function PendingActions({ pending, onRetry, onDiscard, onDone }: { pending: Pending; onRetry: () => void; onDiscard: () => void; onDone: () => void }) {
  return (
    <>
      <Txt variant="small" style={{ paddingHorizontal: space.xl }}>
        {pending.state === "failed" ? (pending.error ?? "This message wasn't sent.") : pending.state === "waiting" ? "Waiting for a connection. It sends on its own when you're back online." : "Sending now."}
      </Txt>
      {pending.state !== "sending" ? (
        <Row
          icon={ArrowClockwiseIcon}
          title="Try again now"
          onPress={() => {
            onRetry();
            onDone();
          }}
        />
      ) : null}
      <Row
        icon={TrashIcon}
        title="Discard message"
        danger
        onPress={() => {
          onDiscard();
          onDone();
        }}
      />
      <Button label="Close" variant="ghost" onPress={onDone} />
    </>
  );
}
