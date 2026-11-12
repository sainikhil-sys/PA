import { Image } from "expo-image";
import { router } from "expo-router";
import { BookmarkSimpleIcon, ChatCircleIcon, ClockIcon, DotsThreeIcon, EyeSlashIcon, FlagIcon, GlobeHemisphereWestIcon, HeartIcon, PencilSimpleIcon, TrashIcon, UsersIcon, UserIcon } from "phosphor-react-native";
import * as React from "react";
import { Pressable, Text, View } from "react-native";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, Input, Row, Txt } from "@/components/ui";
import { PersonAvatar, timeLabel } from "@/features/social/components";
import { ReportSheet } from "@/features/social/report-sheet";
import { errorText } from "@/lib/api";
import { feedback } from "@/lib/feedback";
import { color, font, radius, space, TOUCH } from "@/theme/tokens";
import { usePostActions } from "./api";
import type { Post, PostMedia, Visibility } from "./types";

const VIS_ICON: Record<Visibility, typeof GlobeHemisphereWestIcon> = { public: GlobeHemisphereWestIcon, followers: UserIcon, friends: UsersIcon };
const VIS_A11Y: Record<Visibility, string> = { public: "Visible to everyone", followers: "Visible to followers", friends: "Visible to friends" };

const openProfile = (handle: string) => router.push(`/u/${encodeURIComponent(handle)}`);

/** Photos in a post: one full width, or two to four in a grid. Links expire, so a missing one says so. */
function MediaGrid({ media }: { media: PostMedia[] }) {
  const images = media.filter((m) => m.kind === "image");
  if (!images.length) return null;
  const one = images.length === 1;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, borderRadius: radius.card, overflow: "hidden" }}>
      {images.slice(0, 4).map((m) => {
        const ratio = one && m.width && m.height ? Math.min(Math.max(m.width / m.height, 0.75), 1.8) : 1;
        return m.url ? (
          <Image
            key={m.id}
            source={{ uri: m.url }}
            style={{ width: one ? "100%" : "49.3%", aspectRatio: ratio, backgroundColor: color.surface2 }}
            contentFit="cover"
            transition={150}
            accessibilityLabel="Photo"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View key={m.id} style={{ width: one ? "100%" : "49.3%", aspectRatio: ratio, backgroundColor: color.surface2, alignItems: "center", justifyContent: "center" }}>
            <Txt variant="small">Photo unavailable</Txt>
          </View>
        );
      })}
    </View>
  );
}

function Action({ icon: IconCmp, label, count, active, onPress }: { icon: typeof HeartIcon; label: string; count?: number; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count}` : label}
      accessibilityState={{ selected: Boolean(active) }}
      onPress={() => {
        feedback.selection();
        onPress();
      }}
      hitSlop={4}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH - 8, minWidth: TOUCH, paddingHorizontal: space.xs, opacity: pressed ? 0.6 : 1 })}
    >
      <IconCmp size={20} color={active ? color.accentText : color.muted} weight={active ? "fill" : "regular"} />
      {count ? <Text style={{ fontFamily: font.medium, fontSize: 13, color: active ? color.accentText : color.muted }}>{count}</Text> : null}
    </Pressable>
  );
}

/** One post: author, text, photos, then like, comment and save. The menu holds edit, delete, hide and report. */
export function PostCard({ post, onOpen, showComments = true }: { post: Post; onOpen?: () => void; showComments?: boolean }) {
  const actions = usePostActions();
  const [menu, setMenu] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [report, setReport] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const liked = post.myReactions.includes("like");
  const VisIcon = VIS_ICON[post.visibility] ?? GlobeHemisphereWestIcon;
  const open = onOpen ?? (() => router.push(`/post/${post.id}`));
  const run = (p: Promise<unknown>, after?: () => void) => {
    setError(null);
    p.then(() => after?.()).catch((e: unknown) => setError(errorText(e)));
  };

  return (
    <View style={{ paddingVertical: space.lg, gap: space.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${post.author.name}, @${post.author.handle}. Open profile`} onPress={() => openProfile(post.author.handle)} style={{ flexDirection: "row", alignItems: "center", gap: space.md, flex: 1 }}>
          <PersonAvatar name={post.author.name} url={post.author.avatarUrl} size={40} />
          <View style={{ flex: 1 }}>
            <Txt variant="label" numberOfLines={1}>
              {post.author.name}
            </Txt>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Txt variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
                {`@${post.author.handle}  ·  ${timeLabel(post.createdAt)}${post.editedAt ? "  ·  Edited" : ""}`}
              </Txt>
              <View accessible accessibilityLabel={VIS_A11Y[post.visibility]}>
                <VisIcon size={13} color={color.subtle} />
              </View>
            </View>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Post options" onPress={() => setMenu(true)} hitSlop={8} style={{ width: TOUCH - 8, height: TOUCH - 8, alignItems: "center", justifyContent: "center" }}>
          <DotsThreeIcon size={22} color={color.muted} weight="bold" />
        </Pressable>
      </View>

      {post.status === "held" ? (
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center", padding: space.sm, borderRadius: radius.control, backgroundColor: color.surface }}>
          <ClockIcon size={16} color={color.muted} />
          <Txt variant="small" style={{ flex: 1 }}>
            {"Only you can see this while it's checked. It appears for others once it passes review."}
          </Txt>
        </View>
      ) : null}

      <Pressable accessibilityRole="button" accessibilityLabel="Open post" accessibilityHint="Shows comments" onPress={open} disabled={!showComments} style={{ gap: space.md }}>
        {post.body ? (
          <Text selectable style={{ fontFamily: font.regular, fontSize: 16, lineHeight: 23, color: color.text }} maxFontSizeMultiplier={1.6}>
            {post.body}
          </Text>
        ) : null}
        <MediaGrid media={post.media} />
      </Pressable>

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginLeft: -space.xs }}>
        <Action icon={HeartIcon} label={liked ? "Unlike" : "Like"} count={post.reactionCount} active={liked} onPress={() => actions.react.mutate({ id: post.id, kind: "like" })} />
        {showComments ? <Action icon={ChatCircleIcon} label="Comments" count={post.commentCount} onPress={open} /> : null}
        <View style={{ flex: 1 }} />
        <Action icon={BookmarkSimpleIcon} label={post.saved ? "Remove from saved" : "Save"} active={post.saved} onPress={() => run(actions.save.mutateAsync(post.id))} />
      </View>

      {error ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}

      <Sheet open={menu} onClose={() => setMenu(false)}>
        <View style={{ marginHorizontal: -space.xl }}>
          {post.mine ? (
            <>
              <Row
                icon={PencilSimpleIcon}
                title="Edit text"
                onPress={() => {
                  setMenu(false);
                  setEditing(post.body);
                }}
              />
              <Row
                icon={TrashIcon}
                title="Delete post"
                danger
                onPress={() => {
                  setMenu(false);
                  setConfirmDelete(true);
                }}
              />
            </>
          ) : (
            <>
              <Row icon={EyeSlashIcon} title="Hide this post" detail="You won't see it again." onPress={() => run(actions.hide.mutateAsync(post.id), () => setMenu(false))} />
              <Row
                icon={FlagIcon}
                title="Report post"
                danger
                onPress={() => {
                  setMenu(false);
                  setReport(true);
                }}
              />
            </>
          )}
        </View>
      </Sheet>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title="Edit post">
        <Input value={editing ?? ""} onChangeText={setEditing} multiline maxLength={2000} autoFocus accessibilityLabel="Post text" style={{ minHeight: 120, textAlignVertical: "top", paddingTop: space.md }} />
        <Button label="Save" variant="primary" disabled={!editing?.trim()} loading={actions.edit.isPending} onPress={() => run(actions.edit.mutateAsync({ id: post.id, body: editing!.trim() }), () => setEditing(null))} />
      </Sheet>

      <ConfirmSheet
        open={confirmDelete}
        title="Delete this post?"
        body="It's removed for everyone, with its comments. This can't be undone."
        confirmLabel="Delete post"
        destructive
        busy={actions.remove.isPending}
        onConfirm={() => run(actions.remove.mutateAsync(post.id), () => setConfirmDelete(false))}
        onClose={() => setConfirmDelete(false)}
      />
      <ReportSheet target={report ? { postId: post.id, label: "post" } : null} onClose={() => setReport(false)} />
    </View>
  );
}
