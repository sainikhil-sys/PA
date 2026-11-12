import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { CalendarDotsIcon, ChartBarIcon, MusicNotesIcon, NotepadIcon, TimerIcon, UserCircleIcon } from "phosphor-react-native";
import * as React from "react";
import { Alert, Pressable, Share, View } from "react-native";
import { Sheet } from "@/components/sheet";
import { Button, Card, Input, Row, Txt } from "@/components/ui";
import { Group } from "@/features/settings/parts";
import { errorText } from "@/lib/api";
import { color, radius, space } from "@/theme/tokens";
import {
  useBlockActions,
  useCircleActions,
  useEventActions,
  useEvents,
  useNotes,
  usePollActions,
  usePolls,
  usePostActions,
  usePosts,
  useRoomActions,
  useRooms,
  type CircleDetail,
  type Poll,
  type ReportKind,
} from "./social-api";
import { Choices, formatWhen, Loaded, pickDateTime } from "./social-ui";
import { connectAccent } from "./theme";

type ReportTarget = { kind: ReportKind; id: string; label: string };
const ErrorLine = ({ error }: { error: unknown }) => (error ? <Txt variant="small" style={{ color: color.danger }}>{errorText(error)}</Txt> : null);

// ---------- Posts ----------
export function PostsTab({ circle, onReport }: { circle: CircleDetail; onReport: (t: ReportTarget) => void }) {
  const posts = usePosts(circle.id);
  const a = usePostActions(circle.id);
  const [draft, setDraft] = React.useState("");
  const items = posts.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <View style={{ gap: space.md }}>
      <Input value={draft} onChangeText={setDraft} placeholder={`Write to ${circle.name}`} maxLength={2000} multiline accessibilityLabel="New post" />
      <Button
        label="Post"
        variant="primary"
        disabled={!draft.trim()}
        loading={a.send.isPending}
        onPress={() => a.send.mutate(draft.trim(), { onSuccess: () => setDraft("") })}
      />
      <ErrorLine error={a.send.error} />
      <Loaded q={{ data: posts.data, isLoading: posts.isLoading, error: posts.error, refetch: posts.refetch }}>
        {() =>
          items.length ? (
            <View style={{ gap: space.sm }}>
              {items.map((p) => (
                <Card key={p.id} style={{ gap: space.xs }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
                    <Txt variant="label" style={{ flex: 1 }} numberOfLines={1}>
                      {p.mine ? "You" : p.author}
                    </Txt>
                    <Txt variant="small">{formatWhen(p.createdAt)}</Txt>
                  </View>
                  <Txt selectable>{p.body}</Txt>
                  <View style={{ flexDirection: "row", gap: space.sm, justifyContent: "flex-end" }}>
                    {p.mine || circle.role === "owner" ? (
                      <Button
                        label="Delete"
                        variant="ghost"
                        compact
                        onPress={() =>
                          Alert.alert("Delete this post?", "It is removed for everyone in the circle.", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Delete", style: "destructive", onPress: () => a.remove.mutate(p.id) },
                          ])
                        }
                      />
                    ) : null}
                    {!p.mine ? <Button label="Report" variant="ghost" compact onPress={() => onReport({ kind: "post", id: p.id, label: "post" })} /> : null}
                  </View>
                </Card>
              ))}
              {posts.hasNextPage ? <Button label="Show older posts" loading={posts.isFetchingNextPage} onPress={() => void posts.fetchNextPage()} /> : null}
            </View>
          ) : (
            <Txt variant="small">No posts yet. Posts are visible to members of this circle only.</Txt>
          )
        }
      </Loaded>
    </View>
  );
}

// ---------- Polls ----------
function PollCard({ poll, circle, onReport }: { poll: Poll; circle: CircleDetail; onReport: (t: ReportTarget) => void }) {
  const a = usePollActions(circle.id);
  const canManage = poll.mine || circle.role === "owner";
  return (
    <Card style={{ gap: space.sm }}>
      <Txt variant="heading">{poll.question}</Txt>
      <Txt variant="small">
        {poll.createdBy} · {poll.total} {poll.total === 1 ? "vote" : "votes"}
        {poll.closed ? " · Closed" : ""}
      </Txt>
      {poll.options.map((o, i) => {
        const n = poll.counts[i] ?? 0;
        const pct = poll.total ? Math.round((n / poll.total) * 100) : 0;
        const mine = poll.myVote === i;
        return (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={`${o}, ${n} votes${mine ? ", your vote" : ""}`}
            accessibilityState={{ selected: mine, disabled: poll.closed }}
            disabled={poll.closed || a.vote.isPending}
            onPress={() => a.vote.mutate({ pollId: poll.id, vote: i })}
            style={{ borderRadius: radius.control, borderWidth: 1, borderColor: mine ? connectAccent.main : color.borderStrong, overflow: "hidden", minHeight: 44, justifyContent: "center" }}
          >
            <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, backgroundColor: color.surface3 }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.md, gap: space.sm }}>
              <Txt variant="label" style={{ flex: 1 }}>
                {o}
              </Txt>
              <Txt variant="small">
                {n} ({pct}%)
              </Txt>
            </View>
          </Pressable>
        );
      })}
      <ErrorLine error={a.vote.error} />
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
        {canManage && !poll.closed ? <Button label="Close poll" variant="ghost" compact onPress={() => a.close.mutate(poll.id)} /> : null}
        {canManage ? <Button label="Delete" variant="ghost" compact onPress={() => a.remove.mutate(poll.id)} /> : null}
        {!poll.mine ? <Button label="Report" variant="ghost" compact onPress={() => onReport({ kind: "poll", id: poll.id, label: "poll" })} /> : null}
      </View>
    </Card>
  );
}

export function PollsTab({ circle, onReport }: { circle: CircleDetail; onReport: (t: ReportTarget) => void }) {
  const polls = usePolls(circle.id);
  const a = usePollActions(circle.id);
  const [open, setOpen] = React.useState(false);
  const [question, setQuestion] = React.useState("");
  const [options, setOptions] = React.useState(["", ""]);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  return (
    <View style={{ gap: space.md }}>
      <Button label="New poll" icon={ChartBarIcon} onPress={() => setOpen(true)} />
      <Loaded q={polls}>
        {(items) =>
          items.length ? (
            <View style={{ gap: space.sm }}>
              {items.map((p) => (
                <PollCard key={p.id} poll={p} circle={circle} onReport={onReport} />
              ))}
            </View>
          ) : (
            <Txt variant="small">No polls yet. Members see the totals; nobody sees who voted for what.</Txt>
          )
        }
      </Loaded>
      <Sheet open={open} onClose={() => setOpen(false)} title="New poll">
        <Input label="Question" value={question} onChangeText={setQuestion} maxLength={200} />
        {options.map((o, i) => (
          <Input key={i} value={o} onChangeText={(t) => setOptions((x) => x.map((v, j) => (j === i ? t : v)))} placeholder={`Option ${i + 1}`} maxLength={80} accessibilityLabel={`Option ${i + 1}`} />
        ))}
        {options.length < 6 ? <Button label="Add option" variant="ghost" onPress={() => setOptions((x) => [...x, ""])} /> : null}
        <ErrorLine error={a.create.error} />
        <Button
          label="Start poll"
          variant="primary"
          disabled={!question.trim() || filled.length < 2}
          loading={a.create.isPending}
          onPress={() =>
            a.create.mutate(
              { question: question.trim(), options: filled },
              {
                onSuccess: () => {
                  setOpen(false);
                  setQuestion("");
                  setOptions(["", ""]);
                },
              },
            )
          }
        />
      </Sheet>
    </View>
  );
}

// ---------- Events ----------
export function EventForm({ circleId, communityId, onDone }: { circleId?: string; communityId?: string; onDone: () => void }) {
  const a = useEventActions();
  const [title, setTitle] = React.useState("");
  const [place, setPlace] = React.useState("");
  const [about, setAbout] = React.useState("");
  const [startsAt, setStartsAt] = React.useState<Date | null>(null);
  return (
    <>
      <Input label="Title" value={title} onChangeText={setTitle} maxLength={120} />
      <Input label="Place (optional)" value={place} onChangeText={setPlace} maxLength={200} placeholder="Library room 2, or a video link" />
      <Input label="Details (optional)" value={about} onChangeText={setAbout} maxLength={1000} multiline />
      <Button
        label={startsAt ? `Starts ${formatWhen(startsAt.toISOString())}` : "Choose start time"}
        icon={CalendarDotsIcon}
        onPress={async () => {
          const d = await pickDateTime(startsAt ?? new Date(Date.now() + 86_400_000));
          if (d) setStartsAt(d);
        }}
      />
      <ErrorLine error={a.create.error} />
      <Button
        label="Create event"
        variant="primary"
        disabled={!title.trim() || !startsAt}
        loading={a.create.isPending}
        onPress={() =>
          startsAt &&
          a.create.mutate({ circleId, communityId, title: title.trim(), place: place.trim(), description: about.trim(), startsAt: startsAt.toISOString() }, { onSuccess: onDone })
        }
      />
    </>
  );
}

export function EventsList({ circleId, communityId, canCreate }: { circleId?: string; communityId?: string; canCreate: boolean }) {
  const events = useEvents({ circleId, communityId });
  const [open, setOpen] = React.useState(false);
  return (
    <View style={{ gap: space.md }}>
      {canCreate ? <Button label="New event" icon={CalendarDotsIcon} onPress={() => setOpen(true)} /> : null}
      <Loaded q={events}>
        {(items) =>
          items.length ? (
            <Group>
              {items.map((e) => (
                <Row
                  key={e.id}
                  icon={CalendarDotsIcon}
                  title={e.title}
                  detail={`${formatWhen(e.startsAt)}${e.place ? ` · ${e.place}` : ""} · ${e.going} going${e.myRsvp ? ` · You: ${e.myRsvp}` : ""}`}
                  onPress={() => router.push(`/connect/social/event/${e.id}`)}
                />
              ))}
            </Group>
          ) : (
            <Txt variant="small">No upcoming events.</Txt>
          )
        }
      </Loaded>
      <Sheet open={open} onClose={() => setOpen(false)} title="New event">
        <EventForm circleId={circleId} communityId={communityId} onDone={() => setOpen(false)} />
      </Sheet>
    </View>
  );
}

// ---------- Notes ----------
export function NotesTab({ circle }: { circle: CircleDetail }) {
  const notes = useNotes(circle.id);
  return (
    <View style={{ gap: space.md }}>
      <Button label="New note" icon={NotepadIcon} onPress={() => router.push(`/connect/social/circle/${circle.id}/note/new`)} />
      <Loaded q={notes}>
        {(items) =>
          items.length ? (
            <Group>
              {items.map((n) => (
                <Row
                  key={n.id}
                  icon={NotepadIcon}
                  title={n.title}
                  detail={`Version ${n.version}${n.updatedBy ? ` · Last edit by ${n.updatedBy}` : ""} · ${formatWhen(n.updatedAt)}`}
                  onPress={() => router.push(`/connect/social/circle/${circle.id}/note/${n.id}`)}
                />
              ))}
            </Group>
          ) : (
            <Txt variant="small">Shared notes every member can edit. If two people save at once, the second person sees both versions and chooses.</Txt>
          )
        }
      </Loaded>
    </View>
  );
}

// ---------- Rooms ----------
export function RoomsTab({ circle }: { circle: CircleDetail }) {
  const rooms = useRooms(circle.id);
  const a = useRoomActions(circle.id);
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<"focus" | "listen">("focus");
  const [title, setTitle] = React.useState("");
  return (
    <View style={{ gap: space.md }}>
      <Button label="New room" icon={TimerIcon} onPress={() => setOpen(true)} />
      <Loaded q={rooms}>
        {(items) =>
          items.length ? (
            <Group>
              {items.map((r) => (
                <Row
                  key={r.id}
                  icon={r.kind === "focus" ? TimerIcon : MusicNotesIcon}
                  title={r.title}
                  detail={`${r.kind === "focus" ? "Study room" : "Listen together"} · ${r.present} here now`}
                  onPress={() => router.push(`/connect/social/circle/${circle.id}/room/${r.id}`)}
                />
              ))}
            </Group>
          ) : (
            <Txt variant="small">Study rooms share one focus timer. Listen together rooms share a YouTube or Spotify link and a start time.</Txt>
          )
        }
      </Loaded>
      <Sheet open={open} onClose={() => setOpen(false)} title="New room">
        <Choices
          value={kind}
          onChange={setKind}
          options={[
            { value: "focus", label: "Study room" },
            { value: "listen", label: "Listen together" },
          ]}
        />
        <Txt variant="small">
          {kind === "focus"
            ? "One shared focus timer. Members can choose to show that they are here."
            : "Everyone opens the same link in their own YouTube or Spotify app at the same moment. No audio goes through Cowork."}
        </Txt>
        <Input label="Name" value={title} onChangeText={setTitle} maxLength={60} placeholder={kind === "focus" ? "Exam week" : "Friday playlist"} />
        <ErrorLine error={a.create.error} />
        <Button
          label="Create room"
          variant="primary"
          disabled={!title.trim()}
          loading={a.create.isPending}
          onPress={() =>
            a.create.mutate(
              { kind, title: title.trim() },
              {
                onSuccess: (r) => {
                  setOpen(false);
                  setTitle("");
                  router.push(`/connect/social/circle/${circle.id}/room/${r.id}`);
                },
              },
            )
          }
        />
      </Sheet>
    </View>
  );
}

// ---------- Members ----------
export function MembersTab({ circle, onReport }: { circle: CircleDetail; onReport: (t: ReportTarget) => void }) {
  const a = useCircleActions();
  const b = useBlockActions();
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState<string | null>(null);
  const owner = circle.role === "owner";

  const memberMenu = (m: CircleDetail["members"][number]) => {
    const buttons: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [];
    if (owner) {
      buttons.push({
        text: "Remove from circle",
        style: "destructive",
        onPress: () => a.removeMember.mutate({ circleId: circle.id, userId: m.userId }),
      });
    }
    buttons.push(
      m.blocked
        ? { text: "Unblock", onPress: () => b.unblock.mutate(m.userId) }
        : { text: "Block", style: "destructive", onPress: () => b.block.mutate(m.userId) },
      { text: "Report", onPress: () => onReport({ kind: "user", id: m.userId, label: m.name }) },
      { text: "Cancel", style: "cancel" },
    );
    Alert.alert(m.name, m.blocked ? "Blocked. They cannot invite you or see your presence in rooms." : "Blocking stops them inviting you or seeing your presence in rooms. They are not told.", buttons);
  };

  return (
    <View style={{ gap: space.lg }}>
      {owner && circle.inviteCode ? (
        <Card style={{ gap: space.sm }}>
          <Txt variant="caption">Invite code</Txt>
          <Txt variant="title" selectable accessibilityLabel={`Invite code ${circle.inviteCode.split("").join(" ")}`}>
            {circle.inviteCode}
          </Txt>
          <Txt variant="small">Anyone with this code and a Cowork account can join. Make a new code to stop the old one working.</Txt>
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
            <Button label="Copy" compact onPress={() => void Clipboard.setStringAsync(circle.inviteCode ?? "")} />
            <Button label="Share" compact onPress={() => void Share.share({ message: `Join my circle "${circle.name}" in Cowork Connect with the code ${circle.inviteCode}` })} />
            <Button label="New code" variant="ghost" compact loading={a.update.isPending} onPress={() => a.update.mutate({ circleId: circle.id, newInviteCode: true })} />
          </View>
        </Card>
      ) : null}

      {owner ? (
        <View style={{ gap: space.sm }}>
          <Input label="Invite by email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="name@example.com" />
          <Button
            label="Send invite"
            disabled={!email.includes("@")}
            loading={a.invite.isPending}
            onPress={() =>
              a.invite.mutate(
                { circleId: circle.id, email: email.trim() },
                {
                  onSuccess: (r) => {
                    setSent(r.message);
                    setEmail("");
                  },
                },
              )
            }
          />
          {sent ? <Txt variant="small">{sent}</Txt> : null}
          <ErrorLine error={a.invite.error} />
        </View>
      ) : null}

      <Group>
        {circle.members.map((m) => (
          <Row
            key={m.userId}
            icon={UserCircleIcon}
            title={m.isMe ? `${m.name} (you)` : m.name}
            detail={[m.role === "owner" ? "Owner" : "Member", m.blocked ? "Blocked" : null].filter(Boolean).join(" · ")}
            onPress={m.isMe ? undefined : () => memberMenu(m)}
          />
        ))}
      </Group>
      <ErrorLine error={a.removeMember.error ?? b.block.error ?? b.unblock.error} />

      <Button
        label="Leave circle"
        variant="danger"
        loading={a.leave.isPending}
        onPress={() =>
          Alert.alert(
            "Leave this circle?",
            owner ? "The member who joined first becomes the owner. If you are the only member, the circle is deleted." : "You can join again with an invite or the code.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Leave", style: "destructive", onPress: () => a.leave.mutate(circle.id, { onSuccess: () => router.back() }) },
            ],
          )
        }
      />
      {owner ? (
        <Button
          label="Delete circle"
          variant="danger"
          loading={a.remove.isPending}
          onPress={() =>
            Alert.alert("Delete this circle?", "Posts, polls, notes, rooms and events in it are deleted for everyone. This cannot be undone.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => a.remove.mutate(circle.id, { onSuccess: () => router.back() }) },
            ])
          }
        />
      ) : null}
      {!owner ? <Button label="Report this circle" variant="ghost" onPress={() => onReport({ kind: "circle", id: circle.id, label: "circle" })} /> : null}
      <ErrorLine error={a.leave.error ?? a.remove.error} />
    </View>
  );
}

