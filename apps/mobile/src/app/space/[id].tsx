import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { router, useLocalSearchParams } from "expo-router";
import { CalendarBlankIcon, CaretLeftIcon, ChartBarIcon, LockSimpleIcon, MegaphoneIcon, NoteBlankIcon, PlusIcon, ShareNetworkIcon, UsersThreeIcon, XIcon } from "phosphor-react-native";
import * as React from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Share, TextInput, View } from "react-native";
import { ConfirmSheet, Sheet } from "@/components/sheet";
import { Button, Divider, EmptyState, ErrorState, IconButton, Input, Screen, SectionHeader, Skeleton, Txt } from "@/components/ui";
import { PostCard } from "@/features/feed/components";
import type { Post } from "@/features/feed/types";
import { PersonRow, Segments } from "@/features/social/components";
import { useSpace, useSpaceActions, useSpaceEvents, useSpaceMembers, useSpacePosts } from "@/features/spaces/api";
import { CATEGORY_LABEL, type Space, type SpaceEvent } from "@/features/spaces/types";
import { errorText } from "@/lib/api";
import { color, font, radius, space, TOUCH, type } from "@/theme/tokens";

type Tab = "posts" | "events" | "about" | "people";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** One Space: posts (with polls and announcements), events, about and invites, and its people. */
export default function SpaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useSpace(id);
  const s = q.data;
  const actions = useSpaceActions(s?.id);
  const [tab, setTab] = React.useState<Tab>("posts");
  const [error, setError] = React.useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const [code, setCode] = React.useState("");

  const run = (p: Promise<unknown>, after?: () => void) => {
    setError(null);
    p.then(() => after?.()).catch((e: unknown) => setError(errorText(e)));
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: color.border }}>
      <IconButton icon={CaretLeftIcon} label="Back" tone="plain" onPress={() => (router.canGoBack() ? router.back() : router.replace("/community"))} />
      <Txt variant="heading" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>
        {s?.name ?? "Space"}
      </Txt>
    </View>
  );

  if (q.isPending)
    return (
      <Screen>
        {header}
        <View style={{ padding: space.lg }}>
          <Skeleton rows={4} />
        </View>
      </Screen>
    );
  if (!s)
    return (
      <Screen>
        {header}
        <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
      </Screen>
    );

  const member = s.myStatus === "active";
  const joinButton = member ? (
    <Button label="Leave" compact onPress={() => setConfirmLeave(true)} />
  ) : s.myStatus === "requested" ? (
    <Button label="Request sent" compact variant="ghost" onPress={() => setConfirmLeave(true)} accessibilityLabel="Request sent. Cancel the request" />
  ) : s.archived ? (
    <Txt variant="small">Closed to new members</Txt>
  ) : s.joinPolicy === "invite" ? null : (
    <Button label={s.joinPolicy === "open" ? "Join" : "Ask to join"} variant="primary" compact loading={actions.join.isPending} onPress={() => run(actions.join.mutateAsync(undefined))} />
  );

  return (
    <Screen>
      {header}
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ width: 56, height: 56, borderRadius: radius.card, alignItems: "center", justifyContent: "center", backgroundColor: color.surface2 }}>
            <Txt variant="title" style={{ color: color.accentText }}>
              {s.name.trim().charAt(0).toUpperCase()}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="small">
              {[`${s.memberCount} ${s.memberCount === 1 ? "member" : "members"}`, s.category ? CATEGORY_LABEL[s.category] : null, s.visibility === "private" ? "Private" : "Public"].filter(Boolean).join("  ·  ")}
            </Txt>
            {s.myRole && s.myRole !== "member" ? <Txt variant="small" style={{ color: color.accentText }}>{s.myRole === "owner" ? "You own this Space" : "You moderate this Space"}</Txt> : null}
          </View>
          {joinButton}
        </View>
        {!member && s.joinPolicy === "invite" && !s.archived ? (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Input label="Invite code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} placeholder="Paste the code you were sent" />
            </View>
            <Button label="Join" variant="primary" disabled={!code.trim()} loading={actions.join.isPending} onPress={() => run(actions.join.mutateAsync(code.trim()))} />
          </View>
        ) : null}
        {error ? (
          <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
            {error}
          </Txt>
        ) : null}
        <Segments<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { key: "posts", label: "Posts" },
            { key: "events", label: "Events" },
            { key: "about", label: "About" },
            { key: "people", label: "People" },
          ]}
        />
      </View>

      <View style={{ flex: 1 }}>
        {!s.canRead ? (
          <EmptyState icon={LockSimpleIcon} title="Members only" body={s.joinPolicy === "invite" ? "Join with an invite code to see what's inside." : "Join to see posts, events and people."} />
        ) : tab === "posts" ? (
          <PostsTab s={s} />
        ) : tab === "events" ? (
          <EventsTab s={s} />
        ) : tab === "about" ? (
          <AboutTab s={s} />
        ) : (
          <PeopleTab s={s} />
        )}
      </View>

      <ConfirmSheet
        open={confirmLeave}
        title={member ? `Leave ${s.name}?` : "Cancel your request?"}
        body={member ? (s.visibility === "private" || s.joinPolicy !== "open" ? "You'll need to be approved or invited again to come back." : "You can join again any time.") : "You can ask again later."}
        confirmLabel={member ? "Leave Space" : "Cancel request"}
        destructive={member}
        busy={actions.leave.isPending}
        onConfirm={() => run(actions.leave.mutateAsync(), () => setConfirmLeave(false))}
        onClose={() => setConfirmLeave(false)}
      />
    </Screen>
  );
}

function PostsTab({ s }: { s: Space }) {
  const posts = useSpacePosts(s.id);
  const actions = useSpaceActions(s.id);
  const [composer, setComposer] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const pages = posts.data?.pages ?? [];
  const pinned = pages[0]?.pinned ?? [];
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const items: Post[] = [...pinned.map((p) => ({ ...p, pinned: true })), ...pages.flatMap((p) => p.items).filter((p) => !pinnedIds.has(p.id))];

  return (
    <>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await posts.refetch();
              setRefreshing(false);
            }}
            tintColor={color.accentText}
            colors={[color.accentText]}
            progressBackgroundColor={color.surface2}
          />
        }
        onEndReached={() => {
          if (posts.hasNextPage && !posts.isFetchingNextPage) void posts.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={{ gap: space.md, paddingTop: space.md }}>
            {s.canPost ? <Button label="New post in this Space" icon={PlusIcon} onPress={() => setComposer(true)} /> : null}
            {posts.isPending ? <Skeleton rows={3} height={100} /> : null}
            {posts.isError && !posts.data ? <ErrorState message={errorText(posts.error)} onRetry={() => void posts.refetch()} /> : null}
            {posts.data && !items.length ? <EmptyState icon={NoteBlankIcon} title="No posts yet" body={s.canPost ? "Start the first conversation." : "Posts from members show here."} /> : null}
          </View>
        }
        ItemSeparatorComponent={() => <Divider />}
        renderItem={({ item }) => (
          <View>
            <PostCard post={item} />
            {s.canModerate ? (
              <View style={{ flexDirection: "row", gap: space.lg, marginTop: -space.sm, marginBottom: space.sm }}>
                <Pressable accessibilityRole="button" onPress={() => actions.moderate.mutate({ postId: item.id, action: item.pinned ? "unpin" : "pin" })} hitSlop={8}>
                  <Txt variant="small" style={{ color: color.accentText, fontFamily: font.medium }}>
                    {item.pinned ? "Unpin" : "Pin"}
                  </Txt>
                </Pressable>
                {!item.mine ? (
                  <Pressable accessibilityRole="button" onPress={() => actions.moderate.mutate({ postId: item.id, action: "remove" })} hitSlop={8}>
                    <Txt variant="small" style={{ color: color.danger, fontFamily: font.medium }}>
                      Remove from Space
                    </Txt>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        )}
        ListFooterComponent={posts.isFetchingNextPage ? <ActivityIndicator color={color.accentText} style={{ margin: space.lg }} /> : undefined}
      />
      <SpaceComposer s={s} open={composer} onClose={() => setComposer(false)} />
    </>
  );
}

function SpaceComposer({ s, open, onClose }: { s: Space; open: boolean; onClose: () => void }) {
  const actions = useSpaceActions(s.id);
  const [body, setBody] = React.useState("");
  const [announcement, setAnnouncement] = React.useState(false);
  const [poll, setPoll] = React.useState<string[] | null>(null);
  const close = () => {
    setBody("");
    setAnnouncement(false);
    setPoll(null);
    actions.post.reset();
    onClose();
  };
  const options = poll?.map((o) => o.trim()).filter(Boolean) ?? [];
  const valid = poll ? options.length >= 2 : Boolean(body.trim());
  return (
    <Sheet open={open} onClose={close} title={`Post in ${s.name}`}>
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder={poll ? "Ask a question" : "Write something"}
        placeholderTextColor={color.subtle}
        multiline
        maxLength={5000}
        autoFocus
        accessibilityLabel="Post text"
        style={[type.body, { minHeight: 90, maxHeight: 200, textAlignVertical: "top", padding: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: color.border, backgroundColor: color.bg }]}
      />
      {poll ? (
        <View style={{ gap: space.sm }}>
          {poll.map((o, i) => (
            <View key={i} style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Input value={o} onChangeText={(t) => setPoll((p) => p!.map((x, j) => (j === i ? t : x)))} placeholder={`Option ${i + 1}`} maxLength={80} />
              </View>
              {poll.length > 2 ? <IconButton icon={XIcon} label={`Remove option ${i + 1}`} tone="plain" onPress={() => setPoll((p) => p!.filter((_, j) => j !== i))} /> : null}
            </View>
          ))}
          {poll.length < 6 ? <Button label="Add option" compact variant="ghost" icon={PlusIcon} onPress={() => setPoll((p) => [...p!, ""])} /> : null}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
        <Button label={poll ? "Remove poll" : "Add a poll"} compact icon={ChartBarIcon} onPress={() => setPoll((p) => (p ? null : ["", ""]))} />
        {s.canModerate ? <Button label={announcement ? "Announcement: on" : "Announcement"} compact icon={MegaphoneIcon} variant={announcement ? "primary" : "secondary"} onPress={() => setAnnouncement((v) => !v)} /> : null}
      </View>
      {actions.post.isError ? (
        <Txt variant="small" style={{ color: color.danger }} accessibilityLiveRegion="polite">
          {errorText(actions.post.error)}
        </Txt>
      ) : null}
      <Button
        label="Post"
        variant="primary"
        disabled={!valid}
        loading={actions.post.isPending}
        onPress={() => actions.post.mutate({ body: body.trim(), kind: announcement ? "announcement" : "post", poll: poll ? { options } : null }, { onSuccess: close })}
      />
    </Sheet>
  );
}

function EventsTab({ s }: { s: Space }) {
  const events = useSpaceEvents(s.id);
  const actions = useSpaceActions(s.id);
  const [creating, setCreating] = React.useState(false);
  return (
    <>
      <FlatList
        data={events.data ?? []}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl }}
        ListHeaderComponent={
          <View style={{ gap: space.md, paddingTop: space.md }}>
            {s.canModerate ? <Button label="New event" icon={PlusIcon} onPress={() => setCreating(true)} /> : null}
            {events.isPending ? <Skeleton rows={2} height={80} /> : null}
            {events.isError && !events.data ? <ErrorState message={errorText(events.error)} onRetry={() => void events.refetch()} /> : null}
            {events.data && !events.data.length ? <EmptyState icon={CalendarBlankIcon} title="No upcoming events" body={s.canModerate ? "Add one for your members." : "Events from this Space show here."} /> : null}
            {actions.rsvp.isError ? <Txt variant="small" style={{ color: color.danger }}>{errorText(actions.rsvp.error)}</Txt> : null}
          </View>
        }
        ItemSeparatorComponent={() => <Divider />}
        renderItem={({ item }) => <EventRow e={item} canRsvp={s.myStatus === "active"} onRsvp={(status) => actions.rsvp.mutate({ eventId: item.id, status })} />}
      />
      <NewEventSheet s={s} open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function EventRow({ e, canRsvp, onRsvp }: { e: SpaceEvent; canRsvp: boolean; onRsvp: (s: "going" | "maybe" | "not_going") => void }) {
  return (
    <View style={{ paddingVertical: space.md, gap: space.xs }}>
      <Txt variant="label" style={e.cancelled ? { textDecorationLine: "line-through", color: color.muted } : undefined}>
        {e.title}
      </Txt>
      <Txt variant="small">{[when(e.startsAt), e.location, e.cancelled ? "Cancelled" : `${e.going} going${e.maybe ? `, ${e.maybe} maybe` : ""}`].filter(Boolean).join("  ·  ")}</Txt>
      {e.description ? <Txt variant="small" numberOfLines={3}>{e.description}</Txt> : null}
      {canRsvp && !e.cancelled ? (
        <Segments<"going" | "maybe" | "not_going">
          value={(e.myRsvp ?? "") as "going"}
          onChange={onRsvp}
          options={[
            { key: "going", label: "Going" },
            { key: "maybe", label: "Maybe" },
            { key: "not_going", label: "Can't go" },
          ]}
        />
      ) : null}
    </View>
  );
}

function NewEventSheet({ s, open, onClose }: { s: Space; open: boolean; onClose: () => void }) {
  const actions = useSpaceActions(s.id);
  const [title, setTitle] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [start, setStart] = React.useState<Date | null>(null);
  const pick = () => {
    const base = start ?? new Date(Date.now() + 24 * 3600_000);
    DateTimePickerAndroid.open({
      value: base,
      mode: "date",
      minimumDate: new Date(),
      onValueChange: (_e, d) => {
        if (!d) return;
        DateTimePickerAndroid.open({
          value: d,
          mode: "time",
          onValueChange: (_e2, t) => {
            if (!t) return;
            const out = new Date(d);
            out.setHours(t.getHours(), t.getMinutes(), 0, 0);
            setStart(out);
          },
        });
      },
    });
  };
  const close = () => {
    setTitle("");
    setLocation("");
    setDescription("");
    setStart(null);
    actions.event.reset();
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title="New event">
      <Input label="Title" value={title} onChangeText={setTitle} maxLength={120} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={start ? `Starts ${when(start.toISOString())}. Change` : "Choose when it starts"}
        onPress={pick}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.control, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: pressed ? color.surface2 : color.bg })}
      >
        <CalendarBlankIcon size={18} color={color.muted} />
        <Txt variant="body" style={{ color: start ? color.text : color.subtle }}>
          {start ? when(start.toISOString()) : "When it starts"}
        </Txt>
      </Pressable>
      <Input label="Where (optional)" value={location} onChangeText={setLocation} maxLength={300} />
      <Input label="Details (optional)" value={description} onChangeText={setDescription} multiline maxLength={2000} />
      {actions.event.isError ? <Txt variant="small" style={{ color: color.danger }}>{errorText(actions.event.error)}</Txt> : null}
      <Button
        label="Add event"
        variant="primary"
        disabled={!title.trim() || !start}
        loading={actions.event.isPending}
        onPress={() => start && actions.event.mutate({ title: title.trim(), location: location.trim() || undefined, description: description.trim() || undefined, startsAt: start.toISOString() }, { onSuccess: close })}
      />
    </Sheet>
  );
}

function AboutTab({ s }: { s: Space }) {
  const actions = useSpaceActions(s.id);
  const share = () =>
    actions.invite.mutate(undefined, {
      onSuccess: (inv) =>
        void Share.share({ message: `Join ${s.name} on Cowork. Open the Space and enter this invite code: ${inv.code}${inv.expiresAt ? ` (valid for 7 days)` : ""}` }).catch(() => {}),
    });
  return (
    <FlatList
      data={[]}
      renderItem={() => null}
      contentContainerStyle={{ padding: space.lg, gap: space.xl }}
      ListHeaderComponent={
        <View style={{ gap: space.xl }}>
          <View style={{ gap: space.xs }}>
            <SectionHeader title="About" />
            <Txt variant="body">{s.description || "No description yet."}</Txt>
          </View>
          {s.rules ? (
            <View style={{ gap: space.xs }}>
              <SectionHeader title="Rules" />
              <Txt variant="body">{s.rules}</Txt>
            </View>
          ) : null}
          <Txt variant="small">
            {[
              s.visibility === "private" ? "Private: hidden from search" : "Public: anyone can find it",
              s.joinPolicy === "open" ? "Anyone can join" : s.joinPolicy === "request" ? "Join requests are approved" : "Invite only",
              s.audience === "adults" ? "18 and over" : null,
              s.expiresAt ? `Temporary: closes ${when(s.expiresAt)}` : null,
            ]
              .filter(Boolean)
              .join("\n")}
          </Txt>
          {s.canModerate ? (
            <View style={{ gap: space.sm }}>
              <Button label="Share an invite code" icon={ShareNetworkIcon} loading={actions.invite.isPending} onPress={share} />
              <Txt variant="small">Invite codes work for 7 days. Anyone with one can join, even when the Space is invite only.</Txt>
              {actions.invite.isError ? <Txt variant="small" style={{ color: color.danger }}>{errorText(actions.invite.error)}</Txt> : null}
            </View>
          ) : null}
        </View>
      }
    />
  );
}

function PeopleTab({ s }: { s: Space }) {
  const members = useSpaceMembers(s.id, "active");
  const requests = useSpaceMembers(s.id, "requested", s.canModerate);
  const actions = useSpaceActions(s.id);
  const [remove, setRemove] = React.useState<{ userId: string; name: string } | null>(null);
  const owner = s.myRole === "owner";
  return (
    <>
      <FlatList
        data={members.data ?? []}
        keyExtractor={(m) => m.userId}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxxl }}
        ListHeaderComponent={
          <View style={{ gap: space.md, paddingTop: space.md }}>
            {actions.member.isError ? <Txt variant="small" style={{ color: color.danger }}>{errorText(actions.member.error)}</Txt> : null}
            {s.canModerate && requests.data?.length ? (
              <View>
                <SectionHeader title={`Asking to join (${requests.data.length})`} />
                {requests.data.map((r) => (
                  <PersonRow
                    key={r.userId}
                    person={{ id: r.userId, handle: r.handle, name: r.name, avatarUrl: r.avatarUrl, online: false }}
                    onPress={() => router.push(`/u/${encodeURIComponent(r.handle)}`)}
                    right={
                      <View style={{ flexDirection: "row", gap: space.sm }}>
                        <Button label="Decline" compact variant="ghost" disabled={actions.member.isPending} onPress={() => actions.member.mutate({ userId: r.userId, action: "decline" })} />
                        <Button label="Accept" compact variant="primary" disabled={actions.member.isPending} onPress={() => actions.member.mutate({ userId: r.userId, action: "accept" })} />
                      </View>
                    }
                  />
                ))}
              </View>
            ) : null}
            <SectionHeader title={`${s.memberCount} ${s.memberCount === 1 ? "member" : "members"}`} />
            {members.isPending ? <Skeleton rows={3} height={56} /> : null}
            {members.isError && !members.data ? <ErrorState message={errorText(members.error)} onRetry={() => void members.refetch()} /> : null}
            {members.data && !members.data.length ? <EmptyState icon={UsersThreeIcon} title="No members yet" body="People who join show here." /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <PersonRow
            person={{ id: item.userId, handle: item.handle, name: item.name, avatarUrl: item.avatarUrl, online: false }}
            detail={`@${item.handle}${item.role !== "member" ? `  ·  ${item.role === "owner" ? "Owner" : "Moderator"}` : ""}`}
            onPress={() => router.push(`/u/${encodeURIComponent(item.handle)}`)}
            right={
              s.canModerate && item.role !== "owner" ? (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  {owner ? (
                    <Button
                      label={item.role === "moderator" ? "Make member" : "Make moderator"}
                      compact
                      variant="ghost"
                      disabled={actions.member.isPending}
                      onPress={() => actions.member.mutate({ userId: item.userId, action: item.role === "moderator" ? "make_member" : "make_moderator" })}
                    />
                  ) : null}
                  {item.role === "member" || owner ? <Button label="Remove" compact variant="ghost" onPress={() => setRemove({ userId: item.userId, name: item.name })} /> : null}
                </View>
              ) : undefined
            }
          />
        )}
      />
      <ConfirmSheet
        open={Boolean(remove)}
        title={`Remove ${remove?.name ?? ""}?`}
        body="They leave the Space. They can ask to join again later."
        confirmLabel="Remove"
        destructive
        busy={actions.member.isPending}
        onConfirm={() => remove && actions.member.mutate({ userId: remove.userId, action: "remove" }, { onSettled: () => setRemove(null) })}
        onClose={() => setRemove(null)}
      />
    </>
  );
}
