import { router, useLocalSearchParams } from "expo-router";
import { ArrowBendUpLeftIcon, CaretLeftIcon, ChatCircleIcon, ClockIcon, FlagIcon, PaperPlaneRightIcon, TrashIcon } from "phosphor-react-native";
import * as React from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, Divider, EmptyState, ErrorState, IconButton, Row, Screen, Skeleton, Txt } from "@/components/ui";
import { useCommentActions, useComments, usePost } from "@/features/feed/api";
import { PostCard } from "@/features/feed/components";
import type { Comment } from "@/features/feed/types";
import { PersonAvatar, ReplyPreview, timeLabel } from "@/features/social/components";
import { ReportSheet } from "@/features/social/report-sheet";
import { errorText } from "@/lib/api";
import { color, font, radius, space, TOUCH, type } from "@/theme/tokens";

const COMMENT_MAX = 2000;

/** A post with its comments (oldest first) and a reply box. */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const post = usePost(id);
  const comments = useComments(id);
  const actions = useCommentActions(id);
  const [text, setText] = React.useState("");
  const [replyTo, setReplyTo] = React.useState<Comment | null>(null);
  const [menu, setMenu] = React.useState<Comment | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<Comment | null>(null);
  const [report, setReport] = React.useState<Comment | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [heldNote, setHeldNote] = React.useState(false);

  const items = (comments.data?.pages ?? []).flatMap((p) => p.items);
  const p = post.data;

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setError(null);
    actions.add.mutate(
      { body, parentId: replyTo?.id ?? null },
      {
        onSuccess: (c) => {
          setText("");
          setReplyTo(null);
          setHeldNote(c.status === "held");
        },
        onError: (e) => setError(errorText(e)),
      },
    );
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
      <IconButton icon={CaretLeftIcon} label="Back" tone="plain" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      <Txt variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
        Post
      </Txt>
    </View>
  );

  if (post.isPending)
    return (
      <Screen>
        {header}
        <View style={{ padding: space.lg }}>
          <Skeleton rows={4} />
        </View>
      </Screen>
    );
  if (!p)
    return (
      <Screen>
        {header}
        <ErrorState message={errorText(post.error)} onRetry={() => void post.refetch()} />
      </Screen>
    );

  return (
    <Screen>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {header}
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}
          ListHeaderComponent={
            <View>
              <PostCard post={p} showComments={false} />
              <Divider />
              <Txt variant="caption" style={{ marginTop: space.lg, marginBottom: space.sm }}>
                {p.commentCount === 1 ? "1 comment" : `${p.commentCount} comments`}
              </Txt>
              {comments.isPending ? <Skeleton rows={3} height={48} /> : null}
              {comments.isError && !comments.data ? <ErrorState message={errorText(comments.error)} onRetry={() => void comments.refetch()} /> : null}
              {comments.data && !items.length ? <EmptyState icon={ChatCircleIcon} title="No comments yet" body="Start the conversation." /> : null}
            </View>
          }
          renderItem={({ item }) => <CommentRow comment={item} onLongPress={() => setMenu(item)} onReply={() => setReplyTo(item)} />}
          ListFooterComponent={
            comments.hasNextPage ? (
              <Button label={comments.isFetchingNextPage ? "Loading..." : "Show more comments"} compact variant="ghost" disabled={comments.isFetchingNextPage} onPress={() => void comments.fetchNextPage()} style={{ marginTop: space.sm }} />
            ) : comments.isFetchingNextPage ? (
              <ActivityIndicator color={color.accentText} />
            ) : undefined
          }
        />

        {heldNote ? (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center", paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: color.surface }} accessibilityLiveRegion="polite">
            <ClockIcon size={16} color={color.muted} />
            <Txt variant="small" style={{ flex: 1 }}>
              Your comment is being checked. Others see it once it passes review.
            </Txt>
          </View>
        ) : null}
        {error ? (
          <Txt variant="small" style={{ color: color.danger, paddingHorizontal: space.lg, paddingVertical: space.xs }} accessibilityLiveRegion="polite">
            {error}
          </Txt>
        ) : null}
        <View style={{ paddingBottom: insets.bottom, backgroundColor: color.bg }}>
          {replyTo ? <ReplyPreview name={replyTo.author.name} body={replyTo.body} onCancel={() => setReplyTo(null)} /> : null}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderTopWidth: replyTo ? 0 : 1, borderTopColor: color.border }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={replyTo ? `Reply to ${replyTo.author.name}` : "Add a comment"}
              placeholderTextColor={color.subtle}
              multiline
              maxLength={COMMENT_MAX}
              accessibilityLabel="Comment"
              selectionColor={color.accentText}
              cursorColor={color.accentText}
              style={[type.body, { flex: 1, minHeight: TOUCH, maxHeight: 120, paddingHorizontal: space.md, paddingTop: 13, paddingBottom: 13, borderRadius: radius.control, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface }]}
            />
            <IconButton icon={PaperPlaneRightIcon} label="Send comment" tone="accent" disabled={!text.trim() || actions.add.isPending} onPress={send} />
          </View>
        </View>
      </KeyboardAvoidingView>

      <Sheet open={Boolean(menu)} onClose={() => setMenu(null)}>
        <View style={{ marginHorizontal: -space.xl }}>
          {menu ? (
            <Row
              icon={ArrowBendUpLeftIcon}
              title="Reply"
              onPress={() => {
                setReplyTo(menu);
                setMenu(null);
              }}
            />
          ) : null}
          {menu && (menu.mine || p.mine) ? (
            <Row
              icon={TrashIcon}
              title="Delete comment"
              danger
              onPress={() => {
                setConfirmDelete(menu);
                setMenu(null);
              }}
            />
          ) : null}
          {menu && !menu.mine ? (
            <Row
              icon={FlagIcon}
              title="Report comment"
              danger
              onPress={() => {
                setReport(menu);
                setMenu(null);
              }}
            />
          ) : null}
        </View>
      </Sheet>
      <ConfirmSheet
        open={Boolean(confirmDelete)}
        title="Delete this comment?"
        body="It's removed for everyone. This can't be undone."
        confirmLabel="Delete comment"
        destructive
        busy={actions.remove.isPending}
        onConfirm={() => confirmDelete && actions.remove.mutate(confirmDelete.id, { onError: (e) => setError(errorText(e)), onSettled: () => setConfirmDelete(null) })}
        onClose={() => setConfirmDelete(null)}
      />
      <ReportSheet target={report ? { commentId: report.id, label: "comment" } : null} onClose={() => setReport(null)} />
    </Screen>
  );
}

function CommentRow({ comment, onLongPress, onReply }: { comment: Comment; onLongPress: () => void; onReply: () => void }) {
  return (
    <Pressable
      accessibilityRole="text"
      accessibilityLabel={`${comment.author.name}: ${comment.body}. ${timeLabel(comment.createdAt)}`}
      accessibilityHint="Double tap and hold for options"
      onLongPress={onLongPress}
      delayLongPress={300}
      style={({ pressed }) => ({ flexDirection: "row", gap: space.md, paddingVertical: space.sm, marginLeft: comment.parentId ? space.xxl : 0, opacity: pressed ? 0.8 : 1 })}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${comment.author.name}'s profile`} onPress={() => router.push(`/u/${encodeURIComponent(comment.author.handle)}`)}>
        <PersonAvatar name={comment.author.name} url={comment.author.avatarUrl} size={32} />
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: color.text }}>
          {comment.author.name}
          <Text style={{ fontFamily: font.regular, color: color.subtle }}>{`  ${timeLabel(comment.createdAt)}${comment.editedAt ? "  ·  Edited" : ""}`}</Text>
        </Text>
        <Text selectable style={{ fontFamily: font.regular, fontSize: 15, lineHeight: 21, color: color.text }} maxFontSizeMultiplier={1.6}>
          {comment.body}
        </Text>
        {comment.status === "held" ? <Txt variant="small">Only you can see this while it is checked.</Txt> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={`Reply to ${comment.author.name}`} onPress={onReply} hitSlop={8} style={{ alignSelf: "flex-start", minHeight: 32, justifyContent: "center" }}>
          <Txt variant="small" style={{ color: color.accentText, fontFamily: font.medium }}>
            Reply
          </Txt>
        </Pressable>
      </View>
    </Pressable>
  );
}
