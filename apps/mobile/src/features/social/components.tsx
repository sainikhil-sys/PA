import { Image } from "expo-image";
import {
  ArrowBendUpLeftIcon,
  BellSlashIcon,
  CheckIcon,
  ChecksIcon,
  ClockIcon,
  HandsPrayingIcon,
  HeartIcon,
  SmileyIcon,
  SmileySadIcon,
  SparkleIcon,
  ThumbsUpIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  type Icon,
} from "phosphor-react-native";
import * as React from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { CountBadge, Txt } from "@/components/ui";
import { color, font, radius, space, TOUCH } from "@/theme/tokens";
import type { Pending } from "./outbox";
import type { DmMessage, Person, ReactionKind, ThreadSummary } from "./types";
import { useReduceMotion } from "@/theme/motion";

export const REACTION_ICON: Record<ReactionKind, { icon: Icon; label: string }> = {
  like: { icon: ThumbsUpIcon, label: "Like" },
  love: { icon: HeartIcon, label: "Love" },
  laugh: { icon: SmileyIcon, label: "Funny" },
  wow: { icon: SparkleIcon, label: "Wow" },
  sad: { icon: SmileySadIcon, label: "Sad" },
  thanks: { icon: HandsPrayingIcon, label: "Thanks" },
};

/** Profile photo or initial, with a small orange mark when the person is active now. */
export function PersonAvatar({ name, url, size = 44, online, group }: { name: string; url?: string | null; size?: number; online?: boolean; group?: boolean }) {
  return (
    <View style={{ width: size, height: size }}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: color.surface2, borderWidth: 1, borderColor: color.border }}>
          {group ? (
            <UsersThreeIcon size={size * 0.5} color={color.muted} />
          ) : (
            <Text style={{ fontFamily: font.semibold, fontSize: size * 0.4, color: color.text }} maxFontSizeMultiplier={1.2}>
              {name.trim().charAt(0).toUpperCase() || "?"}
            </Text>
          )}
        </View>
      )}
      {online ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ position: "absolute", right: 0, bottom: 0, width: size * 0.3, height: size * 0.3, borderRadius: size, backgroundColor: color.accent, borderWidth: 2, borderColor: color.bg }}
        />
      ) : null}
    </View>
  );
}

export function timeLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function ThreadRow({ thread, onPress }: { thread: ThreadSummary; onPress: () => void }) {
  const typing = thread.typing.length ? (thread.kind === "direct" ? "Typing..." : `${thread.typing[0]} is typing...`) : null;
  const unread = thread.unread > 0;
  const a11y = [thread.title, thread.online ? "active now" : null, unread ? `${thread.unread} unread` : null, typing ?? thread.preview, timeLabel(thread.updatedAt)].filter(Boolean).join(", ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.sm, minHeight: 72, borderRadius: radius.control, backgroundColor: pressed ? color.surface : "transparent" })}
    >
      <PersonAvatar name={thread.title} url={thread.other?.avatarUrl} online={thread.online} group={thread.kind === "group"} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Txt variant="label" numberOfLines={1} style={{ flex: 1, fontFamily: unread ? font.semibold : font.medium }}>
            {thread.title}
          </Txt>
          {thread.muted ? <BellSlashIcon size={14} color={color.subtle} /> : null}
          <Txt variant="small" style={{ fontSize: 12, color: unread ? color.accentText : color.subtle }}>
            {timeLabel(thread.updatedAt)}
          </Txt>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Txt variant="small" numberOfLines={1} style={{ flex: 1, color: typing ? color.accentText : unread ? color.text : color.muted }}>
            {typing ?? thread.preview ?? (thread.kind === "direct" ? "Say hello" : "No messages yet")}
          </Txt>
          <CountBadge count={thread.unread} />
        </View>
      </View>
    </Pressable>
  );
}

export function PersonRow({ person, detail, right, onPress }: { person: Person; detail?: string; right?: React.ReactNode; onPress?: () => void }) {
  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, minHeight: 64 }}>
      <PersonAvatar name={person.name} url={person.avatarUrl} online={person.online} size={40} />
      <View style={{ flex: 1 }}>
        <Txt variant="label" numberOfLines={1}>
          {person.name}
        </Txt>
        <Txt variant="small" numberOfLines={1}>
          {detail ?? `@${person.handle}${person.online ? "  ·  Active now" : ""}`}
        </Txt>
      </View>
      {right}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${person.name}, @${person.handle}`} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {content}
    </Pressable>
  );
}

/** Small segmented control (rounded squares, never pills). */
export function Segments<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.count ? `${o.label}, ${o.count}` : o.label}
            onPress={() => onChange(o.key)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              minHeight: 36,
              paddingHorizontal: space.md,
              borderRadius: radius.control,
              borderWidth: 1,
              borderColor: on ? color.accent : color.border,
              backgroundColor: on ? color.accent : pressed ? color.surface2 : color.surface,
            })}
          >
            <Txt variant="label" style={{ color: on ? color.onAccent : color.text }}>
              {o.label}
            </Txt>
            {o.count ? (
              <Txt variant="small" style={{ color: on ? color.onAccent : color.accentText, fontFamily: font.semibold }}>
                {o.count > 99 ? "99+" : o.count}
              </Txt>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function StateMark({ state }: { state: DmMessage["state"] | Pending["state"] }) {
  const size = 14;
  switch (state) {
    case "read":
      return (
        <View accessible accessibilityLabel={"Read"}>
          <ChecksIcon size={size} color={color.accentText} weight="bold" />
        </View>
      );
    case "delivered":
      return (
        <View accessible accessibilityLabel={"Delivered"}>
          <ChecksIcon size={size} color={color.subtle} />
        </View>
      );
    case "sent":
      return (
        <View accessible accessibilityLabel={"Sent"}>
          <CheckIcon size={size} color={color.subtle} />
        </View>
      );
    case "sending":
    case "waiting":
      return (
        <View accessible accessibilityLabel={state === "waiting" ? "Waiting for connection" : "Sending"}>
          <ClockIcon size={size} color={color.subtle} />
        </View>
      );
    case "failed":
      return (
        <View accessible accessibilityLabel={"Not sent"}>
          <WarningCircleIcon size={size} color={color.danger} />
        </View>
      );
    default:
      return null;
  }
}

export type BubbleItem =
  | { type: "message"; key: string; message: DmMessage; mine: boolean; senderName: string | null; showName: boolean }
  | { type: "pending"; key: string; pending: Pending }
  | { type: "day"; key: string; label: string };

/** One message. Own messages sit on the right in orange; others on the left in grey. */
export function Bubble({ item, onLongPress, onPressReaction, onRetry }: { item: BubbleItem; onLongPress?: () => void; onPressReaction?: (kind: ReactionKind) => void; onRetry?: () => void }) {
  const reduce = useReduceMotion();
  if (item.type === "day") {
    return (
      <View style={{ alignItems: "center", paddingVertical: space.sm }}>
        <Txt variant="caption">{item.label}</Txt>
      </View>
    );
  }
  if (item.type === "message" && item.message.kind === "system") {
    return (
      <View style={{ alignItems: "center", paddingVertical: space.xs, paddingHorizontal: space.xl }}>
        <Txt variant="small" style={{ textAlign: "center" }}>
          {item.message.body}
        </Txt>
      </View>
    );
  }
  const mine = item.type === "pending" ? true : item.mine;
  const body = item.type === "pending" ? item.pending.body : item.message.deleted ? (mine ? "You deleted this message" : "This message was deleted") : item.message.body;
  const deleted = item.type === "message" && item.message.deleted;
  const reply = item.type === "pending" ? item.pending.replyTo : item.message.replyTo;
  const state = item.type === "pending" ? item.pending.state : item.message.state;
  const time = item.type === "pending" ? null : timeLabel(item.message.createdAt);
  const edited = item.type === "message" && item.message.editedAt && !deleted;
  const reactions = item.type === "message" ? item.message.reactions : [];
  const failed = item.type === "pending" && item.pending.state === "failed";
  const bg = mine ? color.accent : color.surface;
  const fg = mine ? color.onAccent : color.text;

  const a11y = [
    item.type === "message" && !mine && item.senderName ? item.senderName : mine ? "You" : null,
    body,
    edited ? "edited" : null,
    time,
    item.type === "pending" ? (state === "failed" ? `Not sent. ${item.pending.error ?? ""}` : state === "waiting" ? "Waiting for connection" : "Sending") : state ? state : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.duration(180)} style={{ alignItems: mine ? "flex-end" : "flex-start", paddingHorizontal: space.md, marginTop: 2 }}>
      {item.type === "message" && item.showName && item.senderName ? (
        <Txt variant="small" style={{ marginLeft: space.md, marginBottom: 2, fontSize: 12 }}>
          {item.senderName}
        </Txt>
      ) : null}
      <Pressable
        accessibilityRole="text"
        accessibilityLabel={a11y}
        accessibilityHint={onLongPress ? "Double tap and hold for options" : undefined}
        onLongPress={onLongPress}
        onPress={failed ? onRetry : undefined}
        delayLongPress={300}
        style={({ pressed }) => ({
          maxWidth: "82%",
          borderRadius: radius.card,
          borderBottomRightRadius: mine ? 6 : radius.card,
          borderBottomLeftRadius: mine ? radius.card : 6,
          backgroundColor: deleted ? "transparent" : bg,
          borderWidth: deleted || !mine ? 1 : 0,
          borderColor: color.border,
          paddingHorizontal: space.md,
          paddingTop: space.sm,
          paddingBottom: 6,
          opacity: pressed ? 0.85 : item.type === "pending" && state !== "failed" ? 0.75 : 1,
        })}
      >
        {reply ? (
          <View style={{ borderLeftWidth: 3, borderLeftColor: mine ? color.onAccent : color.accentText, paddingLeft: space.sm, marginBottom: space.xs, opacity: 0.85 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12, color: fg }} numberOfLines={1}>
              {reply.senderName}
            </Text>
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: fg }} numberOfLines={2}>
              {reply.body}
            </Text>
          </View>
        ) : null}
        <Text selectable={!deleted} style={{ fontFamily: deleted ? font.regular : font.regular, fontStyle: deleted ? "italic" : "normal", fontSize: 16, lineHeight: 22, color: deleted ? color.muted : fg }} maxFontSizeMultiplier={1.6}>
          {body}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 2 }}>
          {edited ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: mine ? color.onAccent : color.subtle }}>Edited</Text> : null}
          {time ? <Text style={{ fontFamily: font.regular, fontSize: 11, color: mine ? color.onAccent : color.subtle }}>{time}</Text> : null}
          {mine && !deleted ? (
            <View style={{ backgroundColor: color.bg, borderRadius: 4, padding: 1 }}>
              <StateMark state={state} />
            </View>
          ) : null}
        </View>
      </Pressable>
      {failed ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Not sent. Tap to try again" onPress={onRetry} style={{ minHeight: TOUCH - 16, justifyContent: "center" }}>
          <Txt variant="small" style={{ color: color.danger }}>
            {`${item.pending.error ?? "Not sent."} Tap to try again, or hold to discard.`}
          </Txt>
        </Pressable>
      ) : item.type === "pending" && state === "waiting" ? (
        <Txt variant="small" style={{ fontSize: 12 }}>
          Waiting for a connection. It sends on its own.
        </Txt>
      ) : null}
      {reactions.length ? (
        <View style={{ flexDirection: "row", gap: 4, marginTop: 4, flexWrap: "wrap", justifyContent: mine ? "flex-end" : "flex-start" }}>
          {reactions.map((r) => {
            const R = REACTION_ICON[r.kind];
            if (!R) return null;
            return (
              <Pressable
                key={r.kind}
                accessibilityRole="button"
                accessibilityLabel={`${R.label}, ${r.count}${r.mine ? ", including you. Tap to remove yours" : ". Tap to add yours"}`}
                onPress={() => onPressReaction?.(r.kind)}
                hitSlop={6}
                style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, height: 26, borderRadius: 8, borderWidth: 1, borderColor: r.mine ? color.accent : color.border, backgroundColor: color.surface }}
              >
                <R.icon size={14} color={r.mine ? color.accentText : color.muted} weight={r.mine ? "fill" : "regular"} />
                <Txt variant="small" style={{ fontSize: 12, color: r.mine ? color.accentText : color.muted }}>
                  {r.count}
                </Txt>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </Animated.View>
  );
}

export function ReplyPreview({ name, body, onCancel, editing }: { name: string; body: string; onCancel: () => void; editing?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.lg, paddingRight: space.xs, paddingVertical: space.xs, borderTopWidth: 1, borderTopColor: color.border, backgroundColor: color.surface }}>
      <ArrowBendUpLeftIcon size={16} color={color.accentText} />
      <View style={{ flex: 1 }}>
        <Txt variant="small" style={{ color: color.accentText, fontFamily: font.semibold }} numberOfLines={1}>
          {editing ? "Editing your message" : `Replying to ${name}`}
        </Txt>
        <Txt variant="small" numberOfLines={1}>
          {body}
        </Txt>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={editing ? "Cancel editing" : "Cancel reply"} onPress={onCancel} style={{ minWidth: TOUCH, minHeight: TOUCH, alignItems: "center", justifyContent: "center" }}>
        <Txt variant="label">Cancel</Txt>
      </Pressable>
    </View>
  );
}
